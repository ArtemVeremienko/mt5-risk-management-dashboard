"""
Institutional Margin Engine & Broker Specification Resolver.

Handles accurate pre-trade margin budgeting across multiple asset classes:
- Forex (Majors/Minors): Account leverage (e.g. 1:2000, 1:500) with USD-base currency handling.
- Metals (GOLD/XAU, SILVER/XAG): Capped at 1:888 (or account leverage if lower).
- Energies (BRENT, WTI, OIL, CRUDE): Capped at 1:500 (or account leverage if lower).
- Indices (NASDAQ, US500, DOW, DAX, NIKKEI): Capped at 1:500 (or account leverage if lower).
- Equities / Single-Stock CFDs: 4% regulatory CFD margin (1:25 leverage).
- Crypto: Capped at 1:10 leverage (10% margin).

Provides robust shielding against MT5 Python IPC anomalies where broker servers return
corrupted unscaled CFD margin values (e.g. 0.09 instead of 187.75 for BRENT/WTI).
"""

from typing import Dict, Any, Optional, Tuple


def get_category_leverage(category: str, symbol: str = "", acc_leverage: float = 2000.0) -> float:
    """
    Returns authoritative institutional regulatory and broker leverage cap
    for a given asset category and symbol.
    """
    cat = (category or "").upper()
    sym = (symbol or "").upper()
    acc_lev = float(acc_leverage) if acc_leverage > 0 else 2000.0

    # 1. ETFs (4% regulatory CFD margin = 1:25 leverage)
    if "ETF" in cat or "ETFS" in cat:
        return 25.0

    # 2. Equities / Stocks (4% regulatory CFD margin = 1:25 leverage)
    if "STOCK" in cat or "EQUITY" in cat or "EQUITIES" in cat or "SHARES" in cat:
        return 25.0
    if any(ext in sym for ext in [".O", ".N", ".US", ".UK", ".DE"]):
        return 25.0

    # 3. Base Metals (ALUMINIUM, COPPER, LEAD, ZINC, NICKEL -> Capped at 1:100 leverage)
    base_metals = ["ALUMINIUM", "ALUMINUM", "COPPER", "LEAD", "ZINC", "NICKEL"]
    if any(bm in sym for bm in base_metals) or "METALS\\BASE" in cat:
        return min(acc_lev, 100.0)

    # 4. Precious Metals (GOLD, SILVER, XAU, XAG, PLATINUM, PALLADIUM -> Capped at 1:888)
    precious_metals = ["GOLD", "SILVER", "XAU", "XAG", "PLATINUM", "PALLADIUM"]
    if "METAL" in cat or "METALS" in cat or any(m in sym for m in precious_metals):
        return min(acc_lev, 888.0)

    # 5. Energies (BRENT, WTI, OIL, CRUDE, GAS, NGAS -> Capped at 1:500 or 1:200)
    energy_keywords = ["BRENT", "WTI", "OIL", "CRUDE", "NGAS", "NAT.GAS", "GASOLINE"]
    if "ENERGY" in cat or "ENERGIES" in cat or any(e in sym for e in energy_keywords):
        if "NAT.GAS" in sym or "NGAS" in sym or "#USOIL" in sym or "#UKOIL" in sym:
            return min(acc_lev, 200.0)
        return min(acc_lev, 500.0)

    # 6. Futures & Spot Commodities (CORN, WHEAT, SOYBEAN, COFFEE, SUGAR, COTTON -> 1:200)
    commodity_keywords = ["CORN", "WHEAT", "SOY", "COFFEE", "SUGAR", "COTTON", "COCOA"]
    if any(c in sym for c in commodity_keywords) or "COMMODIT" in cat:
        return min(acc_lev, 200.0)

    # 7. Indices (Cash Spot & Futures: NASDAQ, US500, US30, DAX, NIKKEI, etc. -> Capped at 1:500)
    index_keywords = [
        "INDEX", "INDICES", "500", "TECH", "DOW", "DAX", "FTSE", "NIKKEI", "NAS",
        "NASDAQ", "NDAQ", "SPX", "DJ30", "DJIA", "US30", "JP225", "JAPAN", "DE40",
        "DE30", "GERMANY", "UK100", "US100", "US500", "HK50", "WS30", "CAC", "STOXX",
        "RUSSELL", "US2000", "AUS200", "CHINA", "SWISS", "SPAIN"
    ]
    if "INDEX" in cat or "INDICES" in cat or any(idx in sym for idx in index_keywords):
        return min(acc_lev, 500.0)

    # 8. Crypto (1:200 on modern broker CFD tiers, capped at 1:200 or account leverage)
    if "CRYPTO" in cat or "CRYPTOS" in cat or any(c in sym for c in ["BTC", "ETH", "SOL", "XRP", "LTC", "DOGE", "AAVE", "ADA", "BNB"]):
        return min(acc_lev, 200.0)

    # 9. Forex (uses full account leverage)
    if "FOREX" in cat:
        return acc_lev

    # 10. Default fallback for other CFDs / 365 series
    return min(acc_lev, 500.0)


def resolve_margin_specs(
    symbol: str,
    category: str,
    contract_size: float,
    ask: float,
    acc_leverage: float = 2000.0,
    raw_order_margin: Optional[float] = None
) -> Dict[str, float]:
    """
    Resolves exact broker margin_rate and margin_per_lot for a symbol.
    
    Shields against MT5 order_calc_margin returning corrupted base numbers for CFDs
    (e.g., 0.09 for BRENT or 0.44 for GOLD which correspond to implied leverage > 1:5,000).
    When raw_order_margin is absent or corrupted, falls back to institutional category leverage.
    """
    sym = symbol.upper()
    cs = float(contract_size) if contract_size > 0 else 1.0
    price = float(ask) if ask > 0 else 1.0
    acc_lev = float(acc_leverage) if acc_leverage > 0 else 2000.0

    # Determine whether symbol is standard USD-base Forex (e.g. USDJPY, USDCAD, USDCHF)
    is_forex_usd_base = (len(sym) == 6 and sym.isalpha() and sym.startswith("USD") and cs >= 10000.0)
    notional_base = cs if is_forex_usd_base else (cs * price)

    cat_leverage = get_category_leverage(category, symbol, acc_lev)
    default_rate = round(1.0 / cat_leverage, 6)

    # Validate raw_order_margin from MT5 order_calc_margin
    use_raw = False
    if raw_order_margin is not None and raw_order_margin > 0 and notional_base > 0:
        implied_rate = raw_order_margin / notional_base
        # A valid broker margin rate typically falls between 0.0002 (1:5000) and 0.50 (1:2)
        if 0.0002 <= implied_rate <= 0.50:
            use_raw = True
            base_margin_rate = round(implied_rate, 6)
            margin_per_lot = round(raw_order_margin, 4)

    if not use_raw:
        base_margin_rate = default_rate
        margin_per_lot = round(notional_base * base_margin_rate, 4)

    return {
        "margin_rate": base_margin_rate,
        "margin_per_lot": margin_per_lot
    }


def calculate_broker_margin(
    symbol: str,
    lots: float,
    price: float,
    acc_leverage: float,
    user_leverage: Optional[float] = None,
    margin_per_lot: Optional[float] = None,
    ref_price: Optional[float] = None,
    category: str = "",
    contract_size: float = 100000.0
) -> float:
    """
    Calculates exact required broker margin for a trade order, scaled by volume,
    current market price vs. reference price, and custom user leverage.
    """
    lots = max(0.0, float(lots))
    acc_lev = float(acc_leverage) if acc_leverage > 0 else 2000.0

    # Determine base category leverage
    base_cat_lev = get_category_leverage(category, symbol, acc_lev)
    
    # Scale only if a custom user leverage is explicitly provided
    if user_leverage is not None and user_leverage > 0:
        user_cat_lev = get_category_leverage(category, symbol, float(user_leverage))
        scale = (base_cat_lev / user_cat_lev) if (user_cat_lev > 0 and abs(base_cat_lev - user_cat_lev) > 0.1) else 1.0
    else:
        scale = 1.0

    if margin_per_lot is not None and margin_per_lot > 0:
        ref_p = float(ref_price) if (ref_price and ref_price > 0) else price
        price_ratio = (price / ref_p) if (ref_p > 0 and price > 0) else 1.0
        margin = lots * margin_per_lot * price_ratio * scale
        return round(float(margin), 2)

    # Fallback to category leverage computation
    effective_lev = base_cat_lev / scale if scale > 0 else base_cat_lev
    specs = resolve_margin_specs(
        symbol=symbol,
        category=category,
        contract_size=contract_size,
        ask=price,
        acc_leverage=effective_lev
    )
    margin = lots * specs["margin_per_lot"]
    return round(float(margin), 2)
