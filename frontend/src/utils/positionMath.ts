/**
 * Pure Quantitative Finance conversions for open position risk management.
 * Handles bidirectional Price <-> Pips <-> Cash conversions, Break-Even snap arithmetic,
 * and tabular row display telemetry.
 */

export interface PricePipsCashState {
  price: string;
  pips: string;
  cash: string;
  r?: string;
}

export interface SlRowDisplayInfo {
  price: string;
  pipText: string;
  dollarText: string;
  rText: string;
  rMultiple: number;
  isRisk: boolean;
  isBeOrProfit: boolean;
}

export interface TpRowDisplayInfo {
  price: string;
  pipText: string;
  dollarText: string;
  rText: string;
  rMultiple: number;
  isGain: boolean;
}

/**
 * Calculates SL pips and dollar risk from target stop price.
 */
export function slPriceToPipsCash(
  priceVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number
): PricePipsCashState {
  const num = typeof priceVal === 'string' ? parseFloat(priceVal) : priceVal;
  if (isNaN(num) || num <= 0) {
    return {
      price: typeof priceVal === 'string' ? priceVal : '',
      pips: '',
      cash: '',
    };
  }

  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const diff = isBuy ? openPrice - num : num - openPrice;
  const pips = diff / safePipSize;
  const dollar = pips * volume * safePipVal;

  return {
    price: typeof priceVal === 'string' ? priceVal : num.toFixed(digits),
    pips: Math.abs(pips).toFixed(1),
    cash: (-Math.abs(dollar)).toFixed(2),
  };
}

/**
 * Calculates SL price and dollar risk from target pips distance.
 */
export function slPipsToPriceCash(
  pipsVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number
): PricePipsCashState {
  const num = typeof pipsVal === 'string' ? parseFloat(pipsVal) : pipsVal;
  if (isNaN(num) || num <= 0) {
    return {
      price: '',
      pips: typeof pipsVal === 'string' ? pipsVal : '',
      cash: '',
    };
  }

  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const targetPrice = isBuy
    ? openPrice - num * safePipSize
    : openPrice + num * safePipSize;
  const dollar = num * volume * safePipVal;

  return {
    price: Math.max(0, targetPrice).toFixed(digits),
    pips: typeof pipsVal === 'string' ? pipsVal : num.toFixed(1),
    cash: (-dollar).toFixed(2),
  };
}

/**
 * Calculates SL price and pips distance from target cash loss amount.
 */
export function slCashToPricePips(
  cashVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number
): PricePipsCashState {
  const num = typeof cashVal === 'string' ? parseFloat(cashVal) : cashVal;
  if (isNaN(num) || num === 0) {
    return {
      price: '',
      pips: '',
      cash: typeof cashVal === 'string' ? cashVal : '',
    };
  }

  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const absCash = Math.abs(num);
  const denom = volume * safePipVal;
  const pips = denom > 0 ? absCash / denom : 0;
  const targetPrice = isBuy
    ? openPrice - pips * safePipSize
    : openPrice + pips * safePipSize;

  return {
    price: Math.max(0, targetPrice).toFixed(digits),
    pips: pips.toFixed(1),
    cash: typeof cashVal === 'string' ? cashVal : (-absCash).toFixed(2),
  };
}

/**
 * Calculates TP pips and dollar profit from target take-profit price.
 */
export function tpPriceToPipsCash(
  priceVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number
): PricePipsCashState {
  const num = typeof priceVal === 'string' ? parseFloat(priceVal) : priceVal;
  if (isNaN(num) || num <= 0) {
    return {
      price: typeof priceVal === 'string' ? priceVal : '',
      pips: '',
      cash: '',
    };
  }

  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const diff = isBuy ? num - openPrice : openPrice - num;
  const pips = diff / safePipSize;
  const dollar = pips * volume * safePipVal;

  return {
    price: typeof priceVal === 'string' ? priceVal : num.toFixed(digits),
    pips: Math.abs(pips).toFixed(1),
    cash: (+Math.abs(dollar)).toFixed(2),
  };
}

/**
 * Calculates TP price and dollar profit from target pips distance.
 */
export function tpPipsToPriceCash(
  pipsVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number
): PricePipsCashState {
  const num = typeof pipsVal === 'string' ? parseFloat(pipsVal) : pipsVal;
  if (isNaN(num) || num <= 0) {
    return {
      price: '',
      pips: typeof pipsVal === 'string' ? pipsVal : '',
      cash: '',
    };
  }

  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const targetPrice = isBuy
    ? openPrice + num * safePipSize
    : openPrice - num * safePipSize;
  const dollar = num * volume * safePipVal;

  return {
    price: Math.max(0, targetPrice).toFixed(digits),
    pips: typeof pipsVal === 'string' ? pipsVal : num.toFixed(1),
    cash: (+dollar).toFixed(2),
  };
}

/**
 * Calculates TP price and pips distance from target cash profit amount.
 */
export function tpCashToPricePips(
  cashVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number
): PricePipsCashState {
  const num = typeof cashVal === 'string' ? parseFloat(cashVal) : cashVal;
  if (isNaN(num) || num === 0) {
    return {
      price: '',
      pips: '',
      cash: typeof cashVal === 'string' ? cashVal : '',
    };
  }

  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const absCash = Math.abs(num);
  const denom = volume * safePipVal;
  const pips = denom > 0 ? absCash / denom : 0;
  const targetPrice = isBuy
    ? openPrice + pips * safePipSize
    : openPrice - pips * safePipSize;

  return {
    price: Math.max(0, targetPrice).toFixed(digits),
    pips: pips.toFixed(1),
    cash: typeof cashVal === 'string' ? cashVal : (+absCash).toFixed(2),
  };
}

/**
 * Calculates SL price, pips distance, and cash loss from target R-multiple.
 */
export function slRToPricePipsCash(
  rVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number,
  oneRCash: number
): PricePipsCashState {
  const num = typeof rVal === 'string' ? parseFloat(rVal) : rVal;
  if (isNaN(num) || num === 0) {
    return {
      price: '',
      pips: '',
      cash: '',
      r: typeof rVal === 'string' ? rVal : '',
    };
  }

  const safe1R = oneRCash > 0 ? oneRCash : 100.0;
  const cashRisk = -Math.abs(num) * safe1R;
  const res = slCashToPricePips(cashRisk, openPrice, isBuy, volume, pipSize, pipValPerLot, digits);
  return {
    ...res,
    r: typeof rVal === 'string' ? rVal : (-Math.abs(num)).toFixed(2),
  };
}

/**
 * Calculates TP price, pips distance, and cash gain from target R-multiple.
 */
export function tpRToPricePipsCash(
  rVal: string | number,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number,
  oneRCash: number
): PricePipsCashState {
  const num = typeof rVal === 'string' ? parseFloat(rVal) : rVal;
  if (isNaN(num) || num === 0) {
    return {
      price: '',
      pips: '',
      cash: '',
      r: typeof rVal === 'string' ? rVal : '',
    };
  }

  const safe1R = oneRCash > 0 ? oneRCash : 100.0;
  const cashGain = Math.abs(num) * safe1R;
  const res = tpCashToPricePips(cashGain, openPrice, isBuy, volume, pipSize, pipValPerLot, digits);
  return {
    ...res,
    r: typeof rVal === 'string' ? rVal : (+Math.abs(num)).toFixed(2),
  };
}

/**
 * Computes cost-covering Break-Even target price including spread & buffer.
 */
export function calculateBreakEvenPrice(
  openPrice: number,
  isBuy: boolean,
  spreadPips: number,
  pipSize: number,
  digits: number,
  bufferOffsetPips: number = 0.5
): number {
  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const bufferDist = (spreadPips + bufferOffsetPips) * safePipSize;
  const bePrice = isBuy ? openPrice + bufferDist : openPrice - bufferDist;
  return parseFloat(bePrice.toFixed(digits));
}

/**
 * Generates formatted row display telemetry for Stop Loss cell.
 */
export function calculateSlRowInfo(
  sl: number | undefined | null,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number,
  unitLabel: string = 'p',
  oneRCash: number = 100.0
): SlRowDisplayInfo | null {
  if (!sl || sl <= 0) return null;
  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const diff = isBuy ? openPrice - sl : sl - openPrice;
  const pips = diff / safePipSize;
  const isRisk = pips > 0;
  const isBeOrProfit = pips <= 0;
  const absPips = Math.abs(pips);
  const dollarAmount = absPips * volume * safePipVal;
  const safe1R = oneRCash > 0 ? oneRCash : 100.0;
  const rVal = (isRisk ? -dollarAmount : dollarAmount) / safe1R;
  const absR = Math.abs(rVal);
  const rSign = absR < 0.005 ? '' : (isRisk ? '-' : '+');

  return {
    price: sl.toFixed(digits),
    pipText: `${isRisk ? '-' : '+'}${absPips.toFixed(1)} ${unitLabel}`,
    dollarText: `${isRisk ? '-$' : '+$'}${dollarAmount.toFixed(2)}`,
    rText: `${rSign}${absR.toFixed(2)} R`,
    rMultiple: rVal,
    isRisk,
    isBeOrProfit,
  };
}

/**
 * Generates formatted row display telemetry for Take Profit cell.
 */
export function calculateTpRowInfo(
  tp: number | undefined | null,
  openPrice: number,
  isBuy: boolean,
  volume: number,
  pipSize: number,
  pipValPerLot: number,
  digits: number,
  unitLabel: string = 'p',
  oneRCash: number = 100.0
): TpRowDisplayInfo | null {
  if (!tp || tp <= 0) return null;
  const safePipSize = pipSize > 0 ? pipSize : 0.0001;
  const safePipVal = pipValPerLot > 0 ? pipValPerLot : 10.0;
  const diff = isBuy ? tp - openPrice : openPrice - tp;
  const pips = diff / safePipSize;
  const isGain = diff >= 0;
  const absPips = Math.abs(pips);
  const dollarAmount = absPips * volume * safePipVal;
  const safe1R = oneRCash > 0 ? oneRCash : 100.0;
  const rVal = (isGain ? dollarAmount : -dollarAmount) / safe1R;
  const absR = Math.abs(rVal);
  const rSign = absR < 0.005 ? '' : (isGain ? '+' : '-');

  return {
    price: tp.toFixed(digits),
    pipText: `${isGain ? '+' : '-'}${absPips.toFixed(1)} ${unitLabel}`,
    dollarText: `${isGain ? '+$' : '-$'}${dollarAmount.toFixed(2)}`,
    rText: `${rSign}${absR.toFixed(2)} R`,
    rMultiple: rVal,
    isGain,
  };
}
