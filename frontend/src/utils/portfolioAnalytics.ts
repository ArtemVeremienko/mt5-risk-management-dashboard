import { OpenPosition, CalculatedSymbolResult } from '../types';

export interface PortfolioHeatResult {
  totalHeatAmount: number;
  heatPct: number;
  protectedCount: number;
  unprotectedCount: number;
}

export interface CurrencyExposureItem {
  currency: string;
  netLots: number;
  direction: 'LONG' | 'SHORT' | 'FLAT';
}

const MAJOR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

/**
 * Computes aggregate open Stop-Loss risk across all positions.
 * Formula: Heat = sum( |OpenPrice - SL| / PipSize * PipValuePerLot * Volume )
 */
export function calculatePortfolioHeat(
  positions: OpenPosition[],
  getSymbolResult: (symbol: string) => CalculatedSymbolResult | undefined,
  workingCapital: number
): PortfolioHeatResult {
  let totalHeat = 0.0;
  let protectedCount = 0;
  let unprotectedCount = 0;

  for (const pos of positions) {
    if (!pos.sl || pos.sl <= 0) {
      unprotectedCount++;
      continue;
    }

    protectedCount++;
    const pipSize = pos.pip_size && pos.pip_size > 0 ? pos.pip_size : (pos.digits === 3 || pos.digits === 5 ? 0.0001 : 0.01);
    const distPips = pipSize > 0 ? Math.abs(pos.price_open - pos.sl) / pipSize : 0;

    // Get pip value from marketStore calculation or fallback
    const res = getSymbolResult(pos.symbol);
    const pipValPerLot = res?.calc.pip_value_per_lot || 10.0;

    const posRisk = distPips * pipValPerLot * pos.volume;
    if (!isNaN(posRisk) && posRisk > 0) {
      totalHeat += posRisk;
    }
  }

  const safeWc = workingCapital > 0 ? workingCapital : 100.0;
  const heatPct = (totalHeat / safeWc) * 100.0;

  return {
    totalHeatAmount: Math.round(totalHeat * 100) / 100,
    heatPct: Math.round(heatPct * 100) / 100,
    protectedCount,
    unprotectedCount,
  };
}

/**
 * Computes net long/short lot exposure aggregated across major base/quote currencies.
 */
export function calculateNetCurrencyExposure(positions: OpenPosition[]): CurrencyExposureItem[] {
  const exposureMap = new Map<string, number>();
  for (const curr of MAJOR_CURRENCIES) {
    exposureMap.set(curr, 0.0);
  }

  for (const pos of positions) {
    // Strip broker suffixes (e.g. "EURUSD.r", "EURUSD_i", "EURUSDpro")
    const cleanSym = pos.symbol.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (cleanSym.length >= 6) {
      const base = cleanSym.slice(0, 3);
      const quote = cleanSym.slice(3, 6);

      const sign = pos.type === 'BUY' ? 1 : -1;
      const vol = pos.volume || 0;

      if (exposureMap.has(base)) {
        exposureMap.set(base, (exposureMap.get(base) || 0) + sign * vol);
      }
      if (exposureMap.has(quote)) {
        exposureMap.set(quote, (exposureMap.get(quote) || 0) - sign * vol);
      }
    }
  }

  const items: CurrencyExposureItem[] = [];
  for (const [curr, netLots] of exposureMap.entries()) {
    const roundedLots = Math.round(netLots * 100) / 100;
    if (Math.abs(roundedLots) >= 0.01) {
      items.push({
        currency: curr,
        netLots: Math.abs(roundedLots),
        direction: roundedLots > 0 ? 'LONG' : roundedLots < 0 ? 'SHORT' : 'FLAT',
      });
    }
  }

  // Sort by highest absolute exposure
  items.sort((a, b) => b.netLots - a.netLots);
  return items;
}
