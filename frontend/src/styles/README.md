# 🎨 Stylesheet Architecture & Token Reference

This directory implements the 3-Layer Design Token Architecture based on Material Design 3 and Institutional Dark Mode standards.

For detailed guidelines and trade-off analysis, see [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md).

## Layer Structure

```
styles/
├── tokens/
│   ├── primitives.css   # Layer 1: Context-free raw values (--ref-*)
│   └── semantic.css     # Layer 2: Institutional & Domain Roles (--sys-*)
└── views/               # Layer 3: Page & Feature Layouts
    ├── main.css         # App Shell, Header, Controls, Stats, Modals, Toasts
    ├── matrix.css       # Screener Matrix Table, Filters, Sizing Cells, Order Triggers
    └── positions.css    # Open Positions Grid, Dedicated SL/TP, Hub Modal, Toolbar
```

## Quick Token Cheat Sheet

| Category | Semantic Token (`--sys-*`) | Target Value / Primitive |
| :--- | :--- | :--- |
| **Canvas** | `--sys-color-surface` | `#0b0e14` (Deep Canvas) |
| **Card / Panel** | `--sys-color-surface-container` | `#131722` (Card Background) |
| **Hover** | `--sys-color-surface-container-hover` | `#1b202e` (Row / Card Hover) |
| **Input / Inset** | `--sys-color-surface-inset` | `#1e222d` / `#161b26` (Input Background) |
| **Border** | `--sys-color-outline` | `#2a2e39` (Standard Border) |
| **Subtle Divider** | `--sys-color-outline-subtle` | `#20242f` (Subtle Divider) |
| **Primary Text** | `--sys-color-on-surface` | `#f0f3fa` (Primary White Text) |
| **Secondary Text** | `--sys-color-on-surface-variant` | `#9598a1` (Muted Gray Text) |
| **Muted Text** | `--sys-color-on-surface-muted` | `#606470` (Dark Gray Caption) |
| **Brand Blue** | `--sys-color-primary` | `#2962ff` (Brand / Action) |
| **Cyan Accent** | `--sys-color-secondary` | `#00f2fe` (Spread Pill / Highlights) |
| **BUY / Long** | `--sys-color-buy` | `#089981` (Pine Emerald) |
| **SELL / Short** | `--sys-color-sell` | `#f23645` (Crimson Coral) |
| **Profit** | `--sys-color-profit` | `#089981` (Floating Gain) |
| **Loss** | `--sys-color-loss` | `#f23645` (Floating Loss) |
| **Warning** | `--sys-color-warning` | `#ff9800` (Amber / Deviation Clamp) |
