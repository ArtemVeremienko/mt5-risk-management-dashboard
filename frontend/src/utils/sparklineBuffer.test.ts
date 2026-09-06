import { describe, it, expect } from 'vitest';
import { CircularPriceBuffer, getSymbolPriceBuffer, SPARKLINE_CAPACITY } from './sparklineBuffer';

describe('CircularPriceBuffer', () => {
  it('initializes with specified capacity or default', () => {
    const defaultBuf = new CircularPriceBuffer();
    expect(defaultBuf.capacity).toBe(SPARKLINE_CAPACITY);
    expect(defaultBuf.getCount()).toBe(0);
    expect(defaultBuf.isReady()).toBe(false);

    const customBuf = new CircularPriceBuffer(10);
    expect(customBuf.capacity).toBe(10);
  });

  it('ignores NaN and non-positive prices on push', () => {
    const buf = new CircularPriceBuffer(5);
    buf.push(NaN);
    buf.push(0);
    buf.push(-10.5);
    expect(buf.getCount()).toBe(0);
    expect(buf.isReady()).toBe(false);
  });

  it('updates ready state once at least 2 ticks are ingested', () => {
    const buf = new CircularPriceBuffer(5);
    expect(buf.isReady()).toBe(false);
    buf.push(1.0850);
    expect(buf.isReady()).toBe(false);
    buf.push(1.0852);
    expect(buf.isReady()).toBe(true);
    expect(buf.getCount()).toBe(2);
  });

  it('unrolls partially filled buffer chronologically with metrics', () => {
    const buf = new CircularPriceBuffer(5);
    buf.push(10.0);
    buf.push(12.0);
    buf.push(8.0);

    const metrics = { min: 0, max: 0, first: 0, last: 0 };
    const res = buf.getChronological(metrics);

    expect(res.count).toBe(3);
    expect(Array.from(res.data.subarray(0, 3))).toEqual([10.0, 12.0, 8.0]);
    expect(metrics.min).toBe(8.0);
    expect(metrics.max).toBe(12.0);
    expect(metrics.first).toBe(10.0);
    expect(metrics.last).toBe(8.0);
  });

  it('handles ring wrap-around and unrolls in exact chronological order', () => {
    const capacity = 4;
    const buf = new CircularPriceBuffer(capacity);

    // Push 6 values: [1, 2, 3, 4, 5, 6] -> only [3, 4, 5, 6] should remain
    buf.push(1.0);
    buf.push(2.0);
    buf.push(3.0);
    buf.push(4.0);
    buf.push(5.0);
    buf.push(6.0);

    expect(buf.getCount()).toBe(4);

    const metrics = { min: 0, max: 0, first: 0, last: 0 };
    const res = buf.getChronological(metrics);

    expect(res.count).toBe(4);
    expect(Array.from(res.data.subarray(0, 4))).toEqual([3.0, 4.0, 5.0, 6.0]);
    expect(metrics.min).toBe(3.0);
    expect(metrics.max).toBe(6.0);
    expect(metrics.first).toBe(3.0);
    expect(metrics.last).toBe(6.0);
  });

  it('preserves pre-allocated Float32Array across sequential getChronological calls (zero heap allocation)', () => {
    const buf = new CircularPriceBuffer(10);
    buf.push(100.0);
    buf.push(105.0);

    const firstCall = buf.getChronological();
    const secondCall = buf.getChronological();

    // Must be the exact same Float32Array instance
    expect(firstCall.data).toBe(secondCall.data);
  });

  it('handles empty buffer without crashing', () => {
    const buf = new CircularPriceBuffer(10);
    const metrics = { min: 0, max: 0, first: 0, last: 0 };
    const res = buf.getChronological(metrics);
    expect(res.count).toBe(0);
  });

  describe('getSymbolPriceBuffer', () => {
    it('returns the same singleton buffer instance for a symbol', () => {
      const buf1 = getSymbolPriceBuffer('EURUSD');
      const buf2 = getSymbolPriceBuffer('EURUSD');
      const bufGbp = getSymbolPriceBuffer('GBPUSD');

      expect(buf1).toBe(buf2);
      expect(buf1).not.toBe(bufGbp);
    });
  });
});
