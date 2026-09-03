# 🎨 Design System & Token Architecture Guide

> **Scope**: Frontend Design System for MT5 Risk Management & Dynamic Lot Sizing Terminal  
> **Standard**: Material Design 3 (M3) Multi-Tier Token Hierarchy & Institutional Dark Mode Tokens

---

## 🏛️ 1. Architecture Overview (3-Layer Model)

The frontend stylesheet architecture separates style concerns into 3 distinct layers to maintain strict modularity, deterministic cascade, and zero-runtime overhead for 500ms real-time trading updates:

```
frontend/src/
├── index.css                         # Master Barrel Entrypoint
└── styles/
    ├── tokens/
    │   ├── primitives.css            # [Layer 1] System Reference Values (--ref-*)
    │   └── semantic.css              # [Layer 2] Institutional & Domain Roles (--sys-*)
    └── views/                        # [Layer 3] Page & Feature Layouts
        ├── main.css                  # App Shell, Header, Controls, Stats, Modals, Toasts
        ├── matrix.css                # Risk Screener Table, Filters, Sizing Cells, Order Triggers
        └── positions.css             # Open Positions Grid, Dedicated SL/TP, Hub Modal, Toolbar
```

---

## 📐 2. Token Layers & Naming Conventions

### Layer 1: Primitives (`--ref-*`)
Primitive tokens store immutable, context-free raw values. No component or view should reference primitive tokens directly unless establishing a new semantic role.

- **Palette**: Neutral slate (`--ref-color-neutral-0` to `1000`), Institutional Blue (`--ref-color-blue-*`), Cyan (`--ref-color-cyan-*`), Pine Emerald (`--ref-color-emerald-*`), Crimson Coral (`--ref-color-coral-*`), Amber (`--ref-color-amber-*`).
- **Typography**: `--ref-font-sans`, `--ref-font-mono`, weights (`400`–`700`), base sizes (`11px`–`20px`).
- **Spacing Scale**: Linear geometric steps: `--ref-space-1` (2px) to `--ref-space-10` (32px).
- **Radii**: `--ref-radius-xs` (2px) to `--ref-radius-full` (9999px).
- **Shadows / Elevation**: Dark card shadow, modal shadow, subtle border insets, button glow filters.
- **Motion**: Standard durations (`100ms`, `150ms`, `250ms`) and institutional ease curves.

### Layer 2: Semantic System Tokens (`--sys-*`)
Semantic tokens assign meaning and purpose to primitives. All UI components and view stylesheets consume semantic tokens exclusively.

#### Surfaces & Containers
```css
--sys-color-surface: var(--ref-color-neutral-950);              /* #0b0e14 Base terminal canvas */
--sys-color-surface-container: var(--ref-color-neutral-900);    /* #131722 Card / Panel */
--sys-color-surface-container-hover: var(--ref-color-neutral-850); /* #1b202e Interactive row hover */
--sys-color-surface-inset: var(--ref-color-neutral-800);        /* #161b26 / #1e222d Input & nested box */
```

#### Outlines & Borders
```css
--sys-color-outline: var(--ref-color-neutral-700);              /* #2a2e39 Primary container border */
--sys-color-outline-subtle: var(--ref-color-neutral-750);       /* #20242f Subtle divider */
--sys-color-outline-focus: var(--sys-color-primary);            /* Focused interactive border */
```

#### Typography & On-Surface Roles
```css
--sys-color-on-surface: var(--ref-color-neutral-50);            /* #f0f3fa High-contrast primary text */
--sys-color-on-surface-variant: var(--ref-color-neutral-300);    /* #9598a1 Medium emphasis secondary text */
--sys-color-on-surface-muted: var(--ref-color-neutral-500);      /* #606470 Muted captions & labels */
```

#### Trading Domain & Execution Semantics
```css
--sys-color-buy: var(--ref-color-emerald-500);                  /* #089981 Pine Emerald Long entry */
--sys-color-buy-hover: var(--ref-color-emerald-600);            /* #067865 Armed Long hover */
--sys-color-sell: var(--ref-color-coral-500);                   /* #f23645 Crimson Coral Short entry */
--sys-color-sell-hover: var(--ref-color-coral-600);             /* #d02735 Armed Short hover */
--sys-color-profit: var(--ref-color-emerald-500);               /* Floating Profit */
--sys-color-loss: var(--ref-color-coral-500);                   /* Floating Loss */
--sys-color-warning: var(--ref-color-amber-500);                /* #ff9800 Risk deviation clamp alert */
```

---

## ⚖️ 3. Trade-Off Analysis: View-Level CSS vs. Component-Level CSS

| Dimension | View-Level CSS (`views/*.css`) *(Selected)* | Component-Level CSS (`*.module.css` / micro files) |
| :--- | :--- | :--- |
| **Cascade & Cross-Element Coordination** | **High**: Ideal for high-density financial tables where row hover alters sibling button glows, sticky headers coordinate column widths, and CSS subgrids link columns. | **Low**: Difficult to coordinate parent-child hover states or cross-cell layout rules without breaking module boundaries or using `:global()` leaks. |
| **Solid.js Zero-VDOM Suitability** | **Optimal**: Zero runtime overhead. Solid.js compiles to direct DOM updates; flat pure CSS classes eliminate hashing and style recalculation spikes during 500ms WebSocket quote updates. | **Moderate**: Can introduce bundler overhead and CSS-in-JS hashing cost if not purely static. |
| **File Count & Navigation Friction** | **Low (3 view files)**: Rapidly navigate to `matrix.css` or `positions.css` to inspect the complete visual behavior of a screen. | **High (30+ micro files)**: Heavy cognitive overhead jumping between dozens of folders for components that are only ever used in one screen. |
| **Encapsulation & Dead Code Elimination** | **Moderate**: Requires consistent BEM/semantic namespace prefixes (`.matrix-*`, `.pos-*`, `.hub-*`) to avoid collisions. Dead code must be pruned manually if a component is retired. | **High**: Deleting a component automatically deletes its colocated stylesheet with zero dead code leakage. |
| **Code Splitting & Dynamic Bundling** | **Coarse**: Entire view chunks load together. Perfect for desktop trading terminals where all main tabs are immediately interactive. | **Fine-Grained**: CSS can be lazy-loaded per sub-widget, but irrelevant in a sub-150KB institutional SPA. |

### 🎯 Conclusion for this Codebase:
For an ultra-low-latency MT5 trading terminal with real-time quote streaming, **View-Level CSS** delivers the highest performance, simplifies multi-column table layout coordination, and avoids excessive abstraction while cleanly replacing the single monolithic `index.css`.

---

## 🚀 4. Usage Guidelines for Developers & Agents

1. **Never use hardcoded hex colors or arbitrary pixel values** in view files. Always use `var(--sys-*)`.
2. **Typography Rule**: Always apply `font-variant-numeric: tabular-nums` to financial data (prices, lots, margin, P&L) to prevent zero-jitter width oscillations.
3. **Execution Safety**: Execution triggers (`.btn-buy`, `.btn-sell`) must retain high-contrast borders and clear focus/hover outlines to uphold pre-trade safety guarantees.
