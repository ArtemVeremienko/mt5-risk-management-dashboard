import { describe, it, expect } from 'vitest';
import { computeDefaultSlPips, computeLocalRiskForResult } from './lotCalculator';
import { SymbolSpec, TradeStats } from '../types';

describe('lotCalculator', () => {
  describe('computeDefaultSlPips', () => {
    it('returns default 20.0 when spec is null or undefined', () => {
      expect(computeDefaultSlPips(null)).toBe(20.0);
      expect(computeDefaultSlPips(undefined)).toBe(20.0);
    });

    it('calculates 1/4 ADR correctly', () => {
      const spec: Partial<SymbolSpec> = { adr_14_pips: 80.0 };
      expect(computeDefaultSlPips(spec, '1/4 ADR')).toBe(20.0);
    });

    it('calculates 1/3 ADR correctly', () => {
      const spec: Partial<SymbolSpec> = { adr_14_pips: 90.0 };
      expect(computeDefaultSlPips(spec, '1/3 ADR')).toBe(30.0);
    });

    it('calculates 1/2 ADR correctly', () => {
      const spec: Partial<SymbolSpec> = { adr_14_pips: 75.5 };
      expect(computeDefaultSlPips(spec, '1/2 ADR')).toBe(37.8);
    });

    it('calculates 1 ADR correctly', () => {
      const spec: Partial<SymbolSpec> = { adr_14_pips: 65.4 };
      expect(computeDefaultSlPips(spec, '1 ADR')).toBe(65.4);
    });

    it('calculates 1 ATR correctly', () => {
      const spec: Partial<SymbolSpec> = { atr_14_pips: 88.2 };
      expect(computeDefaultSlPips(spec, '1 ATR')).toBe(88.2);
    });

    it('enforces minimum SL floor of 1.0 pip', () => {
      const spec: Partial<SymbolSpec> = { adr_14_pips: 1.0 };
      expect(computeDefaultSlPips(spec, '1/4 ADR')).toBe(1.0);
    });
  });

  describe('computeLocalRiskForResult', () => {
    const baseSpec: SymbolSpec = {
      symbol: 'EURUSD',
      digits: 5,
      point: 0.00001,
      pip_size: 0.0001,
      bid: 1.08500,
      ask: 1.08512,
      spread_pips: 1.2,
      adr_14_pips: 80.0,
      atr_14_pips: 84.0,
      volume_min: 0.01,
      volume_max: 100.0,
      volume_step: 0.01,
      trade_contract_size: 100000.0,
      pip_value_per_lot: 10.0,
      trade_tick_value: 10.0,
      trade_tick_size: 0.00001,
      category: 'Forex Majors',
    };

    const dummyStats: Partial<TradeStats> = {
      total_trades: 50,
      win_rate: 55.0,
      kelly_half: 0.0125, // 1.25%
    };

    it('calculates fixed fractional risk sizing accurately', () => {
      const res = computeLocalRiskForResult(
        baseSpec,
        10000.0, // Working Capital
        10000.0, // Deposited Cash
        100.0,   // Leverage
        'fractional',
        1.0,     // 1% risk = $100
        '1/2 ADR', // 40.0 pips SL
        {},
        dummyStats
      );

      // 10000 * 0.01 = $100 risk amount
      // SL pips = 40.0, pipVal = 10.0 -> riskPerLot = 400
      // Exact lot = 100 / 400 = 0.25
      expect(res.calc.target_risk_amount).toBeCloseTo(100.0, 2);
      expect(res.calc.exact_lot).toBeCloseTo(0.25, 4);
      expect(res.calc.executable_lot).toBe(0.25);
      expect(res.calc.effective_risk_amount).toBeCloseTo(100.0, 2);
      expect(res.calc.effective_risk_pct).toBeCloseTo(1.0, 2);
      expect(res.calc.is_clamped_to_min).toBe(false);
      expect(res.calc.is_clamped_to_max).toBe(false);
    });

    it('strictly enforces conservative volume stepping via flooring with epsilon', () => {
      // Create conditions where exact lot is 0.039 -> should floor to 0.03, never round to 0.04
      const customSpec: SymbolSpec = {
        ...baseSpec,
        pip_value_per_lot: 10.0,
      };

      // Target risk = $15.50 on 40 pips SL -> riskPerLot = 400 -> exact lot = 15.50 / 400 = 0.03875
      const res = computeLocalRiskForResult(
        customSpec,
        1550.0, // Working Capital
        1550.0,
        100.0,
        'fractional',
        1.0, // $15.50
        '1/2 ADR', // 40 pips
        {},
        dummyStats
      );

      expect(res.calc.exact_lot).toBeCloseTo(0.03875, 5);
      // Floor(0.03875 / 0.01) = 3 -> 0.03 lots
      expect(res.calc.executable_lot).toBe(0.03);
      // Effective risk must strictly be <= target risk (15.50)
      expect(res.calc.effective_risk_amount).toBeLessThanOrEqual(res.calc.target_risk_amount);
      expect(res.calc.effective_risk_amount).toBeCloseTo(12.0, 2); // 0.03 * 40 * 10
    });

    it('clamps lot size to volume_min when risk budget is too small', () => {
      const res = computeLocalRiskForResult(
        baseSpec,
        200.0, // Working Capital $200
        200.0,
        100.0,
        'fractional',
        0.5, // 0.5% risk = $1.00
        '1/2 ADR', // 40 pips -> riskPerLot = 400 -> exact lot = 0.0025 < 0.01
        {},
        dummyStats
      );

      expect(res.calc.exact_lot).toBeCloseTo(0.0025, 4);
      expect(res.calc.executable_lot).toBe(0.01);
      expect(res.calc.is_clamped_to_min).toBe(true);
      expect(res.calc.effective_risk_amount).toBe(4.0); // 0.01 * 40 * 10 = $4.00
    });

    it('clamps lot size to volume_max when risk budget is exceptionally large', () => {
      const restrictedSpec: SymbolSpec = {
        ...baseSpec,
        volume_max: 5.0,
      };

      const res = computeLocalRiskForResult(
        restrictedSpec,
        500000.0, // Working Capital $500,000
        500000.0,
        100.0,
        'fractional',
        2.0, // 2% risk = $10,000
        '1/2 ADR', // 40 pips -> riskPerLot = 400 -> exact lot = 25.0 > 5.0
        {},
        dummyStats
      );

      expect(res.calc.exact_lot).toBe(25.0);
      expect(res.calc.executable_lot).toBe(5.0);
      expect(res.calc.is_clamped_to_max).toBe(true);
    });

    it('applies custom symbol SL override over global preset', () => {
      const res = computeLocalRiskForResult(
        baseSpec,
        10000.0,
        10000.0,
        100.0,
        'fractional',
        1.0, // $100 risk
        '1/2 ADR', // would be 40 pips
        { EURUSD: 25.0 }, // Override to 25 pips
        dummyStats
      );

      expect(res.calc.sl_pips).toBe(25.0);
      // 100 / (25 * 10) = 0.40 lots
      expect(res.calc.executable_lot).toBe(0.40);
    });

    it('bounds Dynamic Half-Kelly between min floor and max ceiling', () => {
      // Kelly fraction = 0.05 (5.0%) -> exceeds maxRiskCeilingPct 2.5%
      const highKellyStats: Partial<TradeStats> = {
        kelly_half: 0.05,
      };

      const resCeiling = computeLocalRiskForResult(
        baseSpec,
        10000.0,
        10000.0,
        100.0,
        'kelly_half',
        1.0,
        '1/2 ADR',
        {},
        highKellyStats,
        0.25,
        2.50
      );

      expect(resCeiling.calc.target_risk_pct).toBe(2.50);
      expect(resCeiling.calc.is_ceiling_clamped).toBe(true);

      // Kelly fraction = 0.001 (0.10%) -> below minRiskFloorPct 0.25%
      const lowKellyStats: Partial<TradeStats> = {
        kelly_half: 0.001,
      };

      const resFloor = computeLocalRiskForResult(
        baseSpec,
        10000.0,
        10000.0,
        100.0,
        'kelly_half',
        1.0,
        '1/2 ADR',
        {},
        lowKellyStats,
        0.25,
        2.50
      );

      expect(resFloor.calc.target_risk_pct).toBe(0.25);
      expect(resFloor.calc.is_floor_clamped).toBe(true);
    });

    it('calculates required margin accurately for various asset categories', () => {
      // Forex Majors
      const fxRes = computeLocalRiskForResult(
        baseSpec, // 100,000 contract, lev 100
        10000.0,
        10000.0,
        100.0,
        'fractional',
        1.0,
        '1/2 ADR',
        {},
        dummyStats
      );
      // lots = 0.25, notional = 0.25 * 100000 = 25000 -> margin = 25000 / 100 = 250
      expect(fxRes.calc.required_margin).toBeCloseTo(250.0, 1);

      // Gold / Metals (Capped at 1:888)
      const goldSpec: SymbolSpec = {
        ...baseSpec,
        symbol: 'XAUUSD',
        category: 'Metals',
        trade_contract_size: 100.0,
        bid: 2350.0,
        ask: 2350.3,
        pip_value_per_lot: 10.0,
      };
      const goldRes = computeLocalRiskForResult(
        goldSpec,
        10000.0,
        10000.0,
        500.0, // account lev 500
        'fractional',
        1.0,
        '1/2 ADR',
        {},
        dummyStats
      );
      expect(goldRes.calc.required_margin).toBeGreaterThan(0);

      // Crypto (Leverage capped at 1:200)
      const btcSpec: SymbolSpec = {
        ...baseSpec,
        symbol: 'BTCUSD',
        category: 'Crypto',
        trade_contract_size: 1.0,
        bid: 65000.0,
        ask: 65010.0,
        pip_value_per_lot: 1.0,
      };
      const btcRes = computeLocalRiskForResult(
        btcSpec,
        10000.0,
        10000.0,
        500.0,
        'fractional',
        1.0,
        '1/2 ADR',
        {},
        dummyStats
      );
      expect(btcRes.calc.required_margin).toBeGreaterThan(0);
    });

    it('guards against volume_step <= 0 without throwing RangeError', () => {
      const brokenSpec: SymbolSpec = {
        ...baseSpec,
        volume_step: 0, // invalid step
      };

      expect(() => {
        computeLocalRiskForResult(
          brokenSpec,
          10000.0,
          10000.0,
          100.0,
          'fractional',
          1.0,
          '1/2 ADR',
          {},
          dummyStats
        );
      }).not.toThrow();
    });
  });

  describe('cross-asset normalized volatility calculations', () => {
    it('normalizes EURUSD, BTCUSD, and NAS100 into accurate relative percentage volatility', () => {
      // EURUSD: 80 pips on 1.0850 price = 0.74%
      const eurusdMid = 1.0850;
      const eurusdAdrPct = ((80.0 * 0.0001) / eurusdMid) * 100;
      expect(eurusdAdrPct).toBeCloseTo(0.737, 2);

      // BTCUSD: 3350 points on 84200 price = 3.98%
      const btcMid = 84200.0;
      const btcAdrPct = ((3350.0 * 1.0) / btcMid) * 100;
      expect(btcAdrPct).toBeCloseTo(3.978, 2);

      // NAS100: 240 points on 19850 price = 1.21%
      const nasMid = 19850.0;
      const nasAdrPct = ((240.0 * 1.0) / nasMid) * 100;
      expect(nasAdrPct).toBeCloseTo(1.209, 2);

      // Verify relative ranking: BTC (3.98%) > NAS100 (1.21%) > EURUSD (0.74%)
      expect(btcAdrPct).toBeGreaterThan(nasAdrPct);
      expect(nasAdrPct).toBeGreaterThan(eurusdAdrPct);
    });
  });
});
