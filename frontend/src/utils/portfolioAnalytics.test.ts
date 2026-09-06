import { describe, it, expect } from 'vitest';
import {
  normalizeCashToR,
  formatRMultiple,
  calculatePortfolioHeat,
  calculateNetCurrencyExposure,
} from './portfolioAnalytics';
import { OpenPosition, CalculatedSymbolResult } from '../types';

describe('portfolioAnalytics', () => {
  describe('normalizeCashToR', () => {
    it('normalizes cash amount to R-multiple based on Working Capital and risk percentage', () => {
      // Working Capital = $10,000, 1% risk = $100 baseline 1R
      // -$150 PnL -> -1.5 R
      expect(normalizeCashToR(-150.0, 10000.0, 1.0)).toBeCloseTo(-1.5, 4);

      // +$250 PnL -> +2.5 R
      expect(normalizeCashToR(250.0, 10000.0, 1.0)).toBeCloseTo(2.5, 4);

      // Working Capital = $8,558.02, 1% risk = $85.5802
      expect(normalizeCashToR(-85.5802, 8558.02, 1.0)).toBeCloseTo(-1.0, 4);
    });

    it('falls back safely when working capital or risk percentage is non-positive', () => {
      // Defaults to 100 WC and 1.0% risk -> 1R = $1.00
      expect(normalizeCashToR(-5.0, 0, 0)).toBeCloseTo(-5.0, 4);
      expect(normalizeCashToR(-5.0, -1000, -1)).toBeCloseTo(-5.0, 4);
    });
  });

  describe('formatRMultiple', () => {
    it('formats positive R values with leading +', () => {
      expect(formatRMultiple(1.25)).toBe('+1.25 R');
      expect(formatRMultiple(0.0)).toBe('0.00 R');
    });

    it('formats negative R values with leading -', () => {
      expect(formatRMultiple(-0.75)).toBe('-0.75 R');
    });

    it('omits leading + when showSign is false', () => {
      expect(formatRMultiple(1.25, false)).toBe('1.25 R');
    });
  });

  describe('calculatePortfolioHeat', () => {
    const mockGetSymbolResult = (sym: string): CalculatedSymbolResult | undefined => {
      return {
        calc: {
          pip_value_per_lot: 10.0,
        },
      } as any;
    };

    it('calculates total dollar risk and heat % for protected positions', () => {
      const positions: OpenPosition[] = [
        {
          ticket: 101,
          symbol: 'EURUSD',
          type: 'BUY',
          volume: 1.0,
          price_open: 1.08500,
          sl: 1.08250, // 25 pips -> 25 * 1.0 * $10 = $250 risk
          digits: 5,
          pip_size: 0.0001,
        } as OpenPosition,
        {
          ticket: 102,
          symbol: 'GBPUSD',
          type: 'SELL',
          volume: 0.5,
          price_open: 1.27000,
          sl: 1.27400, // 40 pips -> 40 * 0.5 * $10 = $200 risk
          digits: 5,
          pip_size: 0.0001,
        } as OpenPosition,
      ];

      const result = calculatePortfolioHeat(positions, mockGetSymbolResult, 10000.0);

      // Total heat = 250 + 200 = $450
      expect(result.totalHeatAmount).toBe(450.0);
      // Heat % = 450 / 10000 = 4.5%
      expect(result.heatPct).toBe(4.5);
      expect(result.protectedCount).toBe(2);
      expect(result.unprotectedCount).toBe(0);
    });

    it('identifies and tracks unprotected positions (missing SL)', () => {
      const positions: OpenPosition[] = [
        {
          ticket: 101,
          symbol: 'EURUSD',
          type: 'BUY',
          volume: 1.0,
          price_open: 1.08500,
          sl: 1.08250, // protected
          digits: 5,
          pip_size: 0.0001,
        } as OpenPosition,
        {
          ticket: 102,
          symbol: 'USDJPY',
          type: 'BUY',
          volume: 0.5,
          price_open: 155.000,
          sl: 0, // unprotected
          digits: 3,
          pip_size: 0.01,
        } as OpenPosition,
      ];

      const result = calculatePortfolioHeat(positions, mockGetSymbolResult, 10000.0);

      expect(result.protectedCount).toBe(1);
      expect(result.unprotectedCount).toBe(1);
      expect(result.totalHeatAmount).toBe(250.0);
    });
  });

  describe('calculateNetCurrencyExposure', () => {
    it('decomposes FX pairs into base/quote currencies and offsets opposing exposures', () => {
      const positions: OpenPosition[] = [
        {
          ticket: 1,
          symbol: 'EURUSD',
          type: 'BUY',
          volume: 1.0, // +1.0 EUR, -1.0 USD
        } as OpenPosition,
        {
          ticket: 2,
          symbol: 'GBPUSD',
          type: 'SELL',
          volume: 0.4, // -0.4 GBP, +0.4 USD
        } as OpenPosition,
        {
          ticket: 3,
          symbol: 'EURJPY',
          type: 'SELL',
          volume: 0.5, // -0.5 EUR, +0.5 JPY
        } as OpenPosition,
      ];

      // Net expectations:
      // EUR: +1.0 - 0.5 = +0.5 EUR (LONG)
      // USD: -1.0 + 0.4 = -0.6 USD (SHORT)
      // GBP: -0.4 GBP (SHORT)
      // JPY: +0.5 JPY (LONG)
      const exposures = calculateNetCurrencyExposure(positions);

      const eur = exposures.find((e) => e.currency === 'EUR');
      const usd = exposures.find((e) => e.currency === 'USD');
      const gbp = exposures.find((e) => e.currency === 'GBP');
      const jpy = exposures.find((e) => e.currency === 'JPY');

      expect(eur).toEqual({ currency: 'EUR', netLots: 0.5, direction: 'LONG' });
      expect(usd).toEqual({ currency: 'USD', netLots: 0.6, direction: 'SHORT' });
      expect(gbp).toEqual({ currency: 'GBP', netLots: 0.4, direction: 'SHORT' });
      expect(jpy).toEqual({ currency: 'JPY', netLots: 0.5, direction: 'LONG' });

      // Sorted by descending absolute exposure magnitude: 0.6 USD should be first
      expect(exposures[0].currency).toBe('USD');
    });

    it('strips broker suffixes cleanly', () => {
      const positions: OpenPosition[] = [
        {
          ticket: 1,
          symbol: 'EURUSD.r',
          type: 'BUY',
          volume: 1.0,
        } as OpenPosition,
        {
          ticket: 2,
          symbol: 'USDJPY_i',
          type: 'BUY',
          volume: 1.0,
        } as OpenPosition,
      ];

      const exposures = calculateNetCurrencyExposure(positions);
      const usd = exposures.find((e) => e.currency === 'USD');

      // EURUSD BUY (+1 EUR, -1 USD), USDJPY BUY (+1 USD, -1 JPY) -> USD = 0 (FLAT, filtered out)
      expect(usd).toBeUndefined(); // flat exposures (< 0.01) are omitted
      const eur = exposures.find((e) => e.currency === 'EUR');
      expect(eur?.netLots).toBe(1.0);
    });
  });
});
