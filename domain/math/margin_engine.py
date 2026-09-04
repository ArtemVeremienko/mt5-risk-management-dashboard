"""
Unified Institutional Margin Engine & Broker Specification Resolver.

Handles accurate pre-trade margin budgeting across multiple asset classes:
- Forex (Majors/Minors): Account leverage (e.g. 1:2000, 1:500) with USD-base currency handling.
- Metals (GOLD/XAU, SILVER/XAG): Capped at 1:888 (or account leverage if lower).
- Energies (BRENT, WTI, OIL, CRUDE): Capped at 1:500 or 1:200 (or account leverage if lower).
- Indices (NASDAQ, US500, DOW, DAX, NIKKEI): Capped at 1:500 (or account leverage if lower).
- Equities / Single-Stock CFDs: 4% regulatory CFD margin (1:25 leverage).
- Crypto: Capped at 1:200 leverage.

Provides robust shielding against MT5 Python IPC anomalies where broker servers return
corrupted unscaled CFD margin values (e.g. 0.09 instead of 187.75 for BRENT/WTI).
"""

from typing import Optional, Dict, Any
from domain.models.calculation import MarginSpecs


def get_category_leverage(category: str = "", symbol: str = "", acc_leverage: float = 2000.0) -> float:
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

    # 2. Indices (Cash Spot & Futures: NASDAQ, US500, US30, DAX, NIKKEI, etc. -> Capped at 1:500)
    index_keywords = [
        "INDEX", "INDICES", "500", "TECH", "DOW", "DAX", "FTSE", "NIKKEI", "NAS",
        "NASDAQ", "NDAQ", "SPX", "DJ30", "DJIA", "US30", "JP225", "JAPAN", "DE40",
        "DE30", "GERMANY", "UK100", "US100", "US500", "HK50", "WS30", "CAC", "STOXX",
        "RUSSELL", "US2000", "AUS200", "CHINA", "SWISS", "SPAIN"
    ]
    if "INDEX" in cat or "INDICES" in cat or any(idx in sym for idx in index_keywords):
        return min(acc_lev, 500.0)

    # 3. Equities / Stocks (4% regulatory CFD margin = 1:25 leverage)
    if "STOCK" in cat or "EQUITY" in cat or "EQUITIES" in cat or "SHARES" in cat:
        return 25.0
    stock_exts = [".O", ".N", ".US", ".UK", ".DE"]
    if any(sym.endswith(ext) or f"{ext}_" in sym or f"{ext}." in sym for ext in stock_exts):
        return 25.0

    # 4. Base Metals (ALUMINIUM, COPPER, LEAD, ZINC, NICKEL -> Capped at 1:100 leverage)
    base_metals = ["ALUMINIUM", "ALUMINUM", "COPPER", "LEAD", "ZINC", "NICKEL"]
    if any(bm in sym for bm in base_metals) or "METALS\\BASE" in cat:
        return min(acc_lev, 100.0)

    # 5. Precious Metals (GOLD, SILVER, XAU, XAG, PLATINUM, PALLADIUM -> Capped at 1:888)
    precious_metals = ["GOLD", "SILVER", "XAU", "XAG", "PLATINUM", "PALLADIUM"]
    if "METAL" in cat or "METALS" in cat or any(m in sym for m in precious_metals):
        return min(acc_lev, 888.0)

    # 6. Energies (BRENT, WTI, OIL, CRUDE, GAS, NGAS -> Capped at 1:500 or 1:200)
    energy_keywords = ["BRENT", "WTI", "OIL", "CRUDE", "NGAS", "NAT.GAS", "GASOLINE"]
    if "ENERGY" in cat or "ENERGIES" in cat or any(e in sym for e in energy_keywords):
        if "NAT.GAS" in sym or "NGAS" in sym or "#USOIL" in sym or "#UKOIL" in sym:
            return min(acc_lev, 200.0)
        return min(acc_lev, 500.0)

    # 7. Futures & Spot Commodities (CORN, WHEAT, SOYBEAN, COFFEE, SUGAR, COTTON -> 1:200)
    commodity_keywords = ["CORN", "WHEAT", "SOY", "COFFEE", "SUGAR", "COTTON", "COCOA"]
    if any(c in sym for c in commodity_keywords) or "COMMODIT" in cat:
        return min(acc_lev, 200.0)

    # 8. Crypto (1:200 on modern broker CFD tiers, capped at 1:200 or account leverage)
    if "CRYPTO" in cat or "CRYPTOS" in cat or any(c in sym for c in ["BTC", "ETH", "SOL", "XRP", "LTC", "DOGE", "AAVE", "ADA", "BNB"]):
        return min(acc_lev, 200.0)

    # 9. Forex (uses full account leverage)
    if "FOREX" in cat:
        return acc_lev

    # 10. Default fallback for other CFDs
    return min(acc_lev, 500.0)


def resolve_margin_specs(
    symbol: str,
    category: str = "",
    contract_size: float = 100000.0,
    ask: float = 1.0,
    acc_leverage: float = 2000.0,
    raw_order_margin: Optional[float] = None
) -> MarginSpecs:
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

    return MarginSpecs(
        margin_rate=base_margin_rate,
        margin_per_lot=margin_per_lot,
        category_leverage=cat_leverage
    )


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
    margin = lots * specs.margin_per_lot
    return round(float(margin), 2)


def calculate_required_margin(
    lots: float,
    contract_size: float,
    market_price: float,
    leverage: float,
    margin_rate: float = 1.0,
    currency_base: Optional[str] = None,
    currency_profit: Optional[str] = None,
    currency_margin: Optional[str] = None,
    symbol: str = "",
    margin_per_lot: Optional[float] = None,
    category: str = "",
    conversion_rate: Optional[float] = None
) -> float:
    """
    Unified institutional calculation of required margin for a position in deposit currency (USD):
    - Prioritizes exact margin_per_lot if provided by MT5 terminal.
    - Equities / Single-Stock CFDs: 4% regulatory CFD margin (1:25 leverage).
    - Specialized index handling with dynamic FX conversion rates (with graceful fallbacks).
    - Forex USD-base: (lots * contract_size) / leverage
    - Forex non-USD base: (lots * contract_size * market_price) / leverage
    """
    lots = max(0.0, float(lots))
    if margin_per_lot is not None and margin_per_lot > 0:
        return round(float(lots * margin_per_lot), 2)

    if leverage <= 0:
        leverage = 100.0
    if contract_size <= 0:
        contract_size = 100000.0
    if market_price <= 0:
        market_price = 1.0

    sym_upper = symbol.upper()

    # Specialized index handling for non-USD-denominated CFDs
    if "JP225" in sym_upper or "JPN225" in sym_upper or "NIKKEI" in sym_upper:
        notional_jpy = lots * contract_size * market_price
        # Default JPYUSD rate ~ 1 / 159.5 if not dynamically provided
        fx_rate = conversion_rate if (conversion_rate is not None and conversion_rate > 0) else (1.0 / 159.5)
        margin = notional_jpy * fx_rate
        return round(float(margin), 2)
    elif "DE40" in sym_upper or "GER40" in sym_upper or "DAX" in sym_upper:
        notional_eur = lots * contract_size * market_price
        # Default EURUSD rate ~ 1.16 if not dynamically provided
        eur_usd_rate = conversion_rate if (conversion_rate is not None and conversion_rate > 0) else 1.16
        effective_lev = (leverage / 30.0) if leverage > 0 else 3.06
        margin = (notional_eur * eur_usd_rate) / effective_lev
        return round(float(margin), 2)

    # Equities / Single-Stock CFDs (e.g. AMD.O, AAPL.O, TSLA.O, contract_size ~ 1.0)
    # Regulatory stock CFD margin rate is 4% (1:25 leverage)
    is_stock = (
        any(ext in sym_upper for ext in [".O", ".N", ".US", "AMD", "AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "GOOG", "META"])
        or contract_size <= 10.0
        or "STOCK" in category.upper()
    )
    if is_stock:
        notional_usd = lots * contract_size * market_price
        stock_margin_rate = margin_rate if (0 < margin_rate < 1.0) else 0.04
        margin = notional_usd * stock_margin_rate
        return round(float(margin), 2)

    # Auto-infer currency_base from symbol if not explicitly provided
    if currency_base is None:
        if len(sym_upper) == 6 and sym_upper.isalpha():
            currency_base = sym_upper[:3]
        else:
            currency_base = "EUR" if "EUR" in sym_upper else "USD"

    cat_leverage = get_category_leverage(category, sym_upper, leverage)

    # If base currency is USD for standard Forex pairs (e.g. USDJPY, USDCAD, USDCHF)
    is_forex_usd_base = (
        len(sym_upper) == 6
        and sym_upper.isalpha()
        and (sym_upper.startswith("USD") or currency_base == "USD")
        and contract_size >= 10000
    )
    if is_forex_usd_base:
        notional_usd = lots * contract_size
        effective_rate = margin_rate if (0 < margin_rate < 1.0) else (1.0 / cat_leverage)
        margin = notional_usd * effective_rate
    else:
        # Default non-USD base (EURUSD, GBPUSD, XAUUSD, BTCUSD, BRENT, WTI)
        notional_usd = lots * contract_size * market_price
        effective_rate = margin_rate if (0 < margin_rate < 1.0) else (1.0 / cat_leverage)
        margin = notional_usd * effective_rate

    return round(float(margin), 2)
