/**
 * Zero-GC Circular Price Buffer for Real-Time Sparkline Rendering
 * Reference: docs/05_terminal_comparison_and_sparkline_architecture.md §5.3
 */

export const SPARKLINE_CAPACITY = 120; // 60 seconds at 500ms Turbo Mode

export class CircularPriceBuffer {
  private readonly rawBuffer: Float32Array;
  private readonly renderBuffer: Float32Array;
  private head: number = 0;
  private count: number = 0;
  public readonly capacity: number;

  constructor(capacity: number = SPARKLINE_CAPACITY) {
    this.capacity = capacity;
    this.rawBuffer = new Float32Array(capacity);
    this.renderBuffer = new Float32Array(capacity);
  }

  public push(price: number): void {
    if (isNaN(price) || price <= 0) return;
    this.rawBuffer[this.head] = price;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  public isReady(): boolean {
    return this.count >= 2;
  }

  public getCount(): number {
    return this.count;
  }

  /**
   * Unrolls raw circular data into the pre-allocated renderBuffer in chronological order.
   * Simultaneously extracts min, max, first, and last in a single contiguous O(N) pass.
   * Returns the internal Float32Array and active point count with zero heap allocations.
   */
  public getChronological(outMetrics?: { min: number; max: number; first: number; last: number }): {
    data: Float32Array;
    count: number;
  } {
    if (this.count < 1) {
      return { data: this.renderBuffer, count: 0 };
    }

    const start = this.count < this.capacity ? 0 : this.head;
    let min = this.rawBuffer[start];
    let max = this.rawBuffer[start];
    const first = this.rawBuffer[start];

    for (let i = 0; i < this.count; i++) {
      const val = this.rawBuffer[(start + i) % this.capacity];
      this.renderBuffer[i] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    if (outMetrics) {
      outMetrics.min = min;
      outMetrics.max = max;
      outMetrics.first = first;
      outMetrics.last = this.renderBuffer[this.count - 1];
    }

    return { data: this.renderBuffer, count: this.count };
  }
}

// Global cache of price buffers per symbol
const symbolBuffers = new Map<string, CircularPriceBuffer>();

export function getSymbolPriceBuffer(symbol: string, capacity: number = SPARKLINE_CAPACITY): CircularPriceBuffer {
  let buf = symbolBuffers.get(symbol);
  if (!buf) {
    buf = new CircularPriceBuffer(capacity);
    symbolBuffers.set(symbol, buf);
  }
  return buf;
}
