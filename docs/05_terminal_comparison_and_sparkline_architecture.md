# Terminal UX/UI Comparative Analysis, Discretionary Workflow & Sparkline Architecture

**Author:** Institutional Trading Systems & Quantitative UI Engineering Group  
**Classification:** Full-Stack Architectural Specification & Systems Research  
**Reference Standards:** MetaTrader 5 C-API / IPC, cTrader QuickTrade, TradingView Lightweight Charts, Quantower DOM, Ralph Vince Portfolio Theory, Kelly Criterion

---

## 1. Executive Context & The MT5 "Dumb Design" Dilemma

### 1.1 The Reality of Broker Infrastructure
While modern platforms such as cTrader and TradingView offer fluid charting and visual order interactions, **MetaTrader 5 (MT5)** maintains an overwhelming monopoly (estimated >85% market penetration) across retail FX/CFD brokers, prop trading firms (e.g. FTMO, The5ers, Funding Pips), and retail futures clearing firms (e.g. AMP Futures).

Despite its institutional-grade C++ execution core, MT5’s native user interface suffers from acute architectural and ergonomic deficiencies:
1. **Fragmented Navigation**: Market Watch is split into disconnected tabs (`Quotes`, `Details`, `Trading`). An operator cannot monitor real-time Bid, Ask, Spread, Volatility, and pre-calculated Volume simultaneously on a single screen without continuous context-switching.
2. **Zero Native Dynamic Risk Sizing**: Entering an order requires manually typing arbitrary volume (e.g. `0.50` lots). There is zero native calculation of exact dollar risk, equity percentage risk, or broker-clamped volume step rounding prior to transmission.
3. **Rigid, Un-customizable Presentation**: Aside from basic chart color schemes, the UI chrome, tabular grids, font sizes, and layout density cannot be customized to modern dark-mode ergonomics or low-luminance trading environments.

### 1.2 The True Product Mission
This dashboard does **not** aim to clone or replace charting suites like TradingView. Rather, it functions as an **institutional pre-trade risk engine and multi-asset execution cockpit** for MT5 accounts. It decouples high-frequency mathematical lot sizing and position de-risking from MT5's legacy desktop client.

---

## 2. Platform Comparative Taxonomy

```
+--------------------------------------------------------------------------------------------------------------------------------+
|                                          TERMINAL UX/UI & CAPABILITY BENCHMARK MATRIX                                          |
+----------------------+--------------------+---------------------+---------------------+----------------------------------------+
| Platform             | Position Sizing    | Pending Orders UX   | Charting Engine     | Core Workflow & Identity               |
+----------------------+--------------------+---------------------+---------------------+----------------------------------------+
| MT5 (Desktop C++)    | Manual static lots | Right-click chart / | Desktop C++ GDI;   | Raw execution routing; dated UX;       |
|                      | (no native risk %) | clumsy F9 modal     | rigid M1-MN1 frames | broker monopoly lock-in.               |
+----------------------+--------------------+---------------------+---------------------+----------------------------------------+
| cTrader (Spotware)   | Built-in % / cash  | Best-in-Class:      | Modern, detached;   | Chart-centric discretionary trading;   |
|                      | on chart QuickTrade| draggable lines     | tick, range, renko  | limited multi-asset screener math.     |
+----------------------+--------------------+---------------------+---------------------+----------------------------------------+
| TradingView          | Order panel with % | Drag-and-drop on    | Gold standard HTML5 | Discretionary spatial analysis;        |
|                      | risk (broker sync) | chart; live R:R tags| canvas & PineScript | broker-bridge API latency.             |
+----------------------+--------------------+---------------------+---------------------+----------------------------------------+
| Quantower            | Pre-set templates; | Static DOM ladder   | High-flexibility    | Institutional multi-asset prop desk;   |
|                      | modular order entry| (TT MD Trader-style)| footprint & cluster | steep learning curve; heavy WPF stack. |
+----------------------+--------------------+---------------------+---------------------+----------------------------------------+
| This Dashboard       | Sub-millisecond    | Deprioritized /     | Zero-Bloat:         | Pre-Trade Risk Engine, Dynamic Sizing, |
| (Solid.js + FastAPI) | client math (0ms)  | Native MT5 fallback | Micro-Tick Sparkline| Volatility ADR Radar, 1-Touch Blotter. |
+----------------------+--------------------+---------------------+---------------------+----------------------------------------+
```

---

## 3. Discretionary Trader Workflow Alignment

The user’s operational day follows an established discretionary routine:
1. **Pre-Session Spatial Screening (Monitors 1 & 2)**: The trader uses TradingView or MT5 charts to conduct multi-timeframe structural analysis, identifying **2–3 high-probability instruments** for the session.
2. **Dashboard Focus Pinning**: In the Screener Matrix, the trader clicks `📌` on the 2–3 selected assets, locking them to the top of the grid.
3. **Pre-Trade Volatility & Headroom Verification**: Prior to order entry, the trader checks the **14D ADR Gauge** to ensure the session has not already consumed its statistical range (avoiding breakout exhaustion traps).
4. **Sub-Second Market Execution**: When entry criteria trigger, the trader fires instant `[ BUY ]` or `[ SELL ]` market orders with pre-calculated, broker-compliant volume and pre-set SL/TP brackets routed directly to MT5 in $< 5\text{ms}$.
5. **Frictionless Active Trade Management**: As price unfolds, the trader manages open risk in the Blotter (`HotKey: 2`):
   - Snapping Stop Loss to Break-Even (`[ 🛡️ BE ]`) once $1R$ is reached.
   - Taking 50% partial profits (`[ ✂️ 50% ]`).
   - Fine-tuning stop boundaries via the 3-tier Price/Pips/Cash popover.

---

## 4. The Pending Orders Dilemma & Decision

### 4.1 Why Form-Based Pending Orders Fail Ergonomically
Entering pending orders into a tabular matrix or dialog is notoriously error-prone:
* **Cognitive Inversion**: A trader entering a BUY below market price must select `BUY LIMIT`; a BUY above market price requires `BUY STOP`. Selecting the incorrect type causes MT5 error `10015 (TRADE_RETCODE_INVALID_PRICE)`.
* **Keystroke Latency & Typo Exposure**: Manually typing multi-digit floating prices (e.g. `1.08235`) during market volatility induces unnecessary cognitive load and execution delays.
* **Spatial Blindness**: Pending orders belong at visual structural pivots (swing lows, session extremes, liquidity sweeps). A tabular row lacks spatial reference points.

### 4.2 Architectural Decision
* **Do Not Replicate Full Charting Just For Pending Orders**: Adding a full chart package to enable dragging pending order lines would transform the lightweight dashboard into a redundant cTrader/TradingView clone.
* **Separation of Concerns**: Discretionary traders who occasionally require pending orders at historical swing points can place them directly within MT5 or TradingView.
* **Dashboard Optimization**: The dashboard remains laser-focused on **Instant Market Execution**, **Dynamic Sizing**, and **Active Blotter Management**.

---

## 5. Micro-Tick Sparkline Ribbon Architecture

Rather than full candlestick charting, the screener incorporates an ultra-compact **Micro-Tick Sparkline Ribbon** inside Column 2 (`Market Price & Spread`).

### 5.1 The Fatal Flaws of Raw Tick Counts
Using raw tick counts (e.g., "last 100 ticks") for sparklines introduces severe distortions:
1. **Asset Volatility Heterogeneity**: `XAUUSD` or `US500` can generate 100 ticks in 2 seconds during New York open, whereas `NZDUSD` may require 8 minutes to generate 100 ticks during Asian consolidation. Comparing raw tick slopes across assets produces optical distortion.
2. **Sampling Aliasing**: When polling MT5 via Python IPC at 250ms–500ms, intermediate broker ticks between cycles are dropped. The frontend receives time-sampled price snapshots, not a continuous tick tape.

### 5.2 The Mathematical Model: Uniform Time-Window Sampling
The sparkline operates on a **fixed 60-second linear time window**:
* **Sample Frequency ($f_s$)**: 1.0 Hz (1 sample/second) or 2.0 Hz (500ms Turbo).
* **Buffer Capacity ($N$)**: Exactly 60 data points (for 1 Hz) or 120 data points (for 2 Hz).
* **Linear Time Geometry**: Because $\Delta t = \text{const}$, the horizontal coordinates are mathematical constants:
  $$X_i = i \times \frac{\text{Width}}{N - 1}, \quad i \in [0, N-1]$$
  Horizontal coordinates are never recalculated at runtime.
* **Normalized Price Mapping**:
  $$Y_i = \text{Height} - \left( \frac{\text{Price}_i - P_{\min}}{P_{\max} - P_{\min}} \times \text{Height} \right)$$

### 5.3 High-Performance Data Structure: Zero-GC Circular Ring Buffer
Standard JavaScript array methods (`push` and `shift`) re-index the backing store on every iteration, triggering continuous Garbage Collection (GC) pauses and frame drops under high-frequency WebSocket updates.

The solution is a pre-allocated **`Float32Array` Circular Ring Buffer**:
* **Memory Footprint**: $60 \times 4\text{ bytes} = 240\text{ bytes}$ per symbol.
* **Allocation Overhead**: Zero heap re-allocations post-initialization.
* **Insertion Complexity**: Strictly $O(1)$.
* **Traversal Complexity**: A single contiguous $O(N)$ loop for min/max and vertex extraction ($< 1\mu s$).

```typescript
export class CircularPriceBuffer {
  private readonly buffer: Float32Array;
  private head: number = 0;
  private count: number = 0;
  public readonly capacity: number;

  constructor(capacity: number = 60) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
  }

  public push(price: number): void {
    this.buffer[this.head] = price;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  public isReady(): boolean {
    return this.count >= 2;
  }

  public getChronological(out: Float32Array): number {
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buffer[(start + i) % this.capacity];
    }
    return this.count;
  }
}
```

### 5.4 Selective Rendering & GPU Performance Budget
* **Backend Impact**: **0.00%**. The frontend consumes the `bid` and `ask` prices already broadcast in the sub-second `/ws/live` stream. No new backend endpoints or database queries are created.
* **Selective Frontend Rendering**: Active canvas rendering is restricted to **Pinned (`📌`)** and **Hovered** symbols.
  * Rendering 2–3 active canvases at 2 Hz consumes $< 0.05\text{ms}$ of CPU time per frame, maintaining a stable 60 FPS without layout thrashing.
  * Unpinned rows remain dormant or render a static reference line.

---

## 6. Deprecation of Ralph Vince Optimal $f$ vs. Kelly Criterion

### 6.1 Mathematical Divergence
Both the **Kelly Criterion** ($f^*$) and **Ralph Vince's Optimal $f$** seek to maximize the long-term geometric compounding rate of capital:
$$G(f) = \prod_{k=1}^N \left(1 + f \times \left(-\frac{R_k}{L_{\max}}\right)\right)^{1/N}$$

However, in empirical execution:
1. **Catastrophic Drawdown Variance**: Unconstrained Optimal $f$ frequently recommends allocating $20\%$ to $45\%$ of equity per trade. The resulting probability of experiencing a $>70\%$ drawdown approaches certainty over moderate trade horizons, triggering psychological ruin and breaching broker/prop firm loss ceilings.
2. **Extreme Outlier Sensitivity**: Optimal $f$ relies heavily on the single largest historical loss ($L_{\max}$). A single slippage event or outlier gap artificially distorts the entire sizing curve.

### 6.2 The Institutional Standard: Bounded Half-Kelly
The platform standardizes on **Dynamic Half-Kelly ($f^*/2$)** governed by strict pre-trade risk boundaries:
* **Edge Formulation**:
  $$\text{Edge} = (W \times R) - (1 - W)$$
  $$f^* = \frac{\text{Edge}}{R} = W - \frac{1 - W}{R}$$
* **Conservative Scaling**: Operating at Half-Kelly ($f^*/2$) achieves **75% of maximum growth** while reducing wealth variance and drawdown volatility by **50%**.
* **Pre-Trade Clamping**: The engine enforces strict mathematical floor ($0.50\%$) and ceiling ($2.50\%$) clamps, guaranteeing that statistical overconfidence or temporary win streaks never violate account risk limits.
