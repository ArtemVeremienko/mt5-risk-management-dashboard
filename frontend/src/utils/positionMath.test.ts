import { describe, it, expect } from 'vitest';
import {
  slPriceToPipsCash,
  slPipsToPriceCash,
  slCashToPricePips,
  tpPriceToPipsCash,
  tpPipsToPriceCash,
  tpCashToPricePips,
  slRToPricePipsCash,
  tpRToPricePipsCash,
  calculateBreakEvenPrice,
  calculateSlRowInfo,
  calculateTpRowInfo,
} from './positionMath';

describe('positionMath', () => {
  const openPrice = 1.08500;
  const volume = 1.0;
  const pipSize = 0.0001;
  const pipValPerLot = 10.0;
  const digits = 5;
  const oneRCash = 100.0;

  describe('Bidirectional Stop Loss Conversions', () => {
    describe('slPriceToPipsCash', () => {
      it('calculates pips and dollar risk for BUY position', () => {
        // Stop price below entry
        const res = slPriceToPipsCash('1.08250', openPrice, true, volume, pipSize, pipValPerLot, digits);
        expect(res.price).toBe('1.08250');
        expect(res.pips).toBe('25.0');
        expect(res.cash).toBe('-250.00'); // 25 pips * 1.0 lot * $10 = -$250
      });

      it('calculates pips and dollar risk for SELL position', () => {
        // Stop price above entry
        const res = slPriceToPipsCash('1.08750', openPrice, false, volume, pipSize, pipValPerLot, digits);
        expect(res.price).toBe('1.08750');
        expect(res.pips).toBe('25.0');
        expect(res.cash).toBe('-250.00');
      });

      it('gracefully handles invalid price values', () => {
        const res = slPriceToPipsCash('', openPrice, true, volume, pipSize, pipValPerLot, digits);
        expect(res.price).toBe('');
        expect(res.pips).toBe('');
        expect(res.cash).toBe('');
      });
    });

    describe('slPipsToPriceCash', () => {
      it('calculates price and dollar loss from pips for BUY', () => {
        const res = slPipsToPriceCash('20.0', openPrice, true, volume, pipSize, pipValPerLot, digits);
        // 1.08500 - (20 * 0.0001) = 1.08300
        expect(res.price).toBe('1.08300');
        expect(res.pips).toBe('20.0');
        expect(res.cash).toBe('-200.00');
      });

      it('calculates price and dollar loss from pips for SELL', () => {
        const res = slPipsToPriceCash('20.0', openPrice, false, volume, pipSize, pipValPerLot, digits);
        // 1.08500 + (20 * 0.0001) = 1.08700
        expect(res.price).toBe('1.08700');
        expect(res.pips).toBe('20.0');
        expect(res.cash).toBe('-200.00');
      });
    });

    describe('slCashToPricePips', () => {
      it('calculates price and pips from target cash risk for BUY', () => {
        // Target loss -$150 -> 15 pips on 1.0 lot ($10/pip)
        const res = slCashToPricePips('-150.00', openPrice, true, volume, pipSize, pipValPerLot, digits);
        expect(res.pips).toBe('15.0');
        expect(res.price).toBe('1.08350');
        expect(res.cash).toBe('-150.00');
      });

      it('calculates price and pips from target cash risk for SELL', () => {
        const res = slCashToPricePips('-150.00', openPrice, false, volume, pipSize, pipValPerLot, digits);
        expect(res.pips).toBe('15.0');
        expect(res.price).toBe('1.08650');
      });
    });

    describe('slRToPricePipsCash', () => {
      it('calculates price, pips, and cash loss from R-multiple', () => {
        // Target risk -1.5 R -> cash = -1.5 * $100 = -$150 -> 15 pips
        const res = slRToPricePipsCash('-1.5', openPrice, true, volume, pipSize, pipValPerLot, digits, oneRCash);
        expect(res.r).toBe('-1.5');
        expect(res.cash).toBe('-150.00');
        expect(res.pips).toBe('15.0');
        expect(res.price).toBe('1.08350');
      });
    });
  });

  describe('Bidirectional Take Profit Conversions', () => {
    describe('tpPriceToPipsCash', () => {
      it('calculates pips and profit cash for BUY position', () => {
        const res = tpPriceToPipsCash('1.09000', openPrice, true, volume, pipSize, pipValPerLot, digits);
        expect(res.price).toBe('1.09000');
        expect(res.pips).toBe('50.0');
        expect(res.cash).toBe('500.00');
      });

      it('calculates pips and profit cash for SELL position', () => {
        const res = tpPriceToPipsCash('1.08000', openPrice, false, volume, pipSize, pipValPerLot, digits);
        expect(res.price).toBe('1.08000');
        expect(res.pips).toBe('50.0');
        expect(res.cash).toBe('500.00');
      });
    });

    describe('tpPipsToPriceCash', () => {
      it('calculates target price and profit from pips for BUY', () => {
        const res = tpPipsToPriceCash('35.0', openPrice, true, volume, pipSize, pipValPerLot, digits);
        expect(res.price).toBe('1.08850');
        expect(res.cash).toBe('350.00');
      });

      it('calculates target price and profit from pips for SELL', () => {
        const res = tpPipsToPriceCash('35.0', openPrice, false, volume, pipSize, pipValPerLot, digits);
        expect(res.price).toBe('1.08150');
        expect(res.cash).toBe('350.00');
      });
    });

    describe('tpCashToPricePips', () => {
      it('calculates target price and pips from cash gain for BUY', () => {
        const res = tpCashToPricePips('250.00', openPrice, true, volume, pipSize, pipValPerLot, digits);
        expect(res.pips).toBe('25.0');
        expect(res.price).toBe('1.08750');
        expect(res.cash).toBe('250.00');
      });
    });

    describe('tpRToPricePipsCash', () => {
      it('calculates price, pips, and cash profit from target R-multiple', () => {
        // Target gain +2.0 R -> cash = +2.0 * $100 = +$200 -> 20 pips
        const resStr = tpRToPricePipsCash('2.0', openPrice, true, volume, pipSize, pipValPerLot, digits, oneRCash);
        expect(resStr.r).toBe('2.0'); // preserves user typing string
        expect(resStr.cash).toBe('200.00');
        expect(resStr.pips).toBe('20.0');
        expect(resStr.price).toBe('1.08700');

        // When number is passed
        const resNum = tpRToPricePipsCash(2.0, openPrice, true, volume, pipSize, pipValPerLot, digits, oneRCash);
        expect(resNum.r).toBe('2.00');
        expect(resNum.cash).toBe('200.00');
      });
    });
  });

  describe('Break-Even Calculations', () => {
    it('calculates cost-covering Break-Even price for BUY with spread buffer', () => {
      const spreadPips = 1.2;
      const bufferOffset = 0.5;
      // Total buffer = (1.2 + 0.5) * 0.0001 = 0.00017 -> 1.08500 + 0.00017 = 1.08517
      const bePrice = calculateBreakEvenPrice(openPrice, true, spreadPips, pipSize, digits, bufferOffset);
      expect(bePrice).toBe(1.08517);
    });

    it('calculates cost-covering Break-Even price for SELL with spread buffer', () => {
      const spreadPips = 1.2;
      const bufferOffset = 0.5;
      // Total buffer = 0.00017 -> 1.08500 - 0.00017 = 1.08483
      const bePrice = calculateBreakEvenPrice(openPrice, false, spreadPips, pipSize, digits, bufferOffset);
      expect(bePrice).toBe(1.08483);
    });
  });

  describe('Row Display Telemetry', () => {
    it('generates formatted telemetry for at-risk Stop Loss', () => {
      const sl = 1.08250; // 25 pips below entry for BUY
      const info = calculateSlRowInfo(sl, openPrice, true, volume, pipSize, pipValPerLot, digits, 'p', oneRCash);
      expect(info).not.toBeNull();
      expect(info!.price).toBe('1.08250');
      expect(info!.pipText).toBe('-25.0 p');
      expect(info!.dollarText).toBe('-$250.00');
      expect(info!.rText).toBe('-2.50 R');
      expect(info!.isRisk).toBe(true);
      expect(info!.isBeOrProfit).toBe(false);
    });

    it('generates formatted telemetry for in-profit Stop Loss (trailing stop past entry)', () => {
      const sl = 1.08600; // 10 pips above entry for BUY
      const info = calculateSlRowInfo(sl, openPrice, true, volume, pipSize, pipValPerLot, digits, 'p', oneRCash);
      expect(info).not.toBeNull();
      expect(info!.price).toBe('1.08600');
      expect(info!.pipText).toBe('+10.0 p');
      expect(info!.dollarText).toBe('+$100.00');
      expect(info!.rText).toBe('+1.00 R');
      expect(info!.isRisk).toBe(false);
      expect(info!.isBeOrProfit).toBe(true);
    });

    it('returns null when Stop Loss is 0 or unset', () => {
      expect(calculateSlRowInfo(0, openPrice, true, volume, pipSize, pipValPerLot, digits)).toBeNull();
      expect(calculateSlRowInfo(undefined, openPrice, true, volume, pipSize, pipValPerLot, digits)).toBeNull();
    });

    it('generates formatted telemetry for Take Profit cell', () => {
      const tp = 1.09000; // 50 pips above entry for BUY
      const info = calculateTpRowInfo(tp, openPrice, true, volume, pipSize, pipValPerLot, digits, 'p', oneRCash);
      expect(info).not.toBeNull();
      expect(info!.price).toBe('1.09000');
      expect(info!.pipText).toBe('+50.0 p');
      expect(info!.dollarText).toBe('+$500.00');
      expect(info!.rText).toBe('+5.00 R');
      expect(info!.isGain).toBe(true);
    });
  });
});
