import { createSignal, createMemo, createRoot } from 'solid-js';
import { accountStore } from './accountStore';

function createPreferences() {
  const savedDeltaStr = localStorage.getItem('mt5_risk_reserve_delta');
  let initialDelta: number | null = null;

  if (savedDeltaStr !== null && !isNaN(parseFloat(savedDeltaStr))) {
    initialDelta = parseFloat(savedDeltaStr);
  } else {
    // Migration: Check legacy custom working capital
    const legacyWcStr = localStorage.getItem('mt5_risk_working_capital');
    if (legacyWcStr !== null && !isNaN(parseFloat(legacyWcStr))) {
      const legacyTarget = parseFloat(legacyWcStr);
      const curBal = accountStore.account().balance ?? 0;
      initialDelta = Math.max(0, legacyTarget - curBal);
      localStorage.setItem('mt5_risk_reserve_delta', initialDelta.toString());
      localStorage.removeItem('mt5_risk_working_capital');
    }
  }

  const [reserveDelta, setReserveDelta] = createSignal<number | null>(initialDelta);

  const workingCapital = createMemo<number>(() => {
    const bal = accountStore.account().balance;
    const curBal = bal !== undefined && bal !== null && bal > 0 ? bal : 0;
    const delta = reserveDelta();

    if (delta !== null) {
      return Math.max(1.0, curBal + delta);
    }
    if (curBal > 0) {
      return curBal;
    }
    return 100.0;
  });

  const isWorkingCapitalCustom = createMemo<boolean>(() => {
    return reserveDelta() !== null;
  });

  const setWorkingCapital = (targetVal: number) => {
    if (!isNaN(targetVal) && targetVal > 0) {
      const curBal = accountStore.account().balance ?? 0;
      const delta = targetVal - curBal;
      setReserveDelta(delta);
      localStorage.setItem('mt5_risk_reserve_delta', delta.toString());
      localStorage.removeItem('mt5_risk_working_capital');
    }
  };

  const resetWorkingCapital = () => {
    localStorage.removeItem('mt5_risk_reserve_delta');
    localStorage.removeItem('mt5_risk_working_capital');
    setReserveDelta(null);
  };

  const rawRiskMethod = localStorage.getItem('mt5_risk_method') || 'fractional';
  const initialRiskMethod = rawRiskMethod === 'kelly_half' ? 'kelly_half' : 'fractional';
  const [riskMethod, setRiskMethodSignal] = createSignal<string>(initialRiskMethod);

  const [customRiskPct, setCustomRiskPctSignal] = createSignal<number>(
    parseFloat(localStorage.getItem('mt5_risk_custom_pct') || '1.0') || 1.0
  );
  const [minRiskFloorPct, setMinRiskFloorPctSignal] = createSignal<number>(
    parseFloat(localStorage.getItem('mt5_min_risk_floor') || '0.25') || 0.25
  );
  const [maxRiskCeilingPct, setMaxRiskCeilingPctSignal] = createSignal<number>(
    parseFloat(localStorage.getItem('mt5_max_risk_ceiling') || '2.50') || 2.50
  );

  const storedTarget = localStorage.getItem('mt5_monthly_income_target');
  let initialTarget = 1000;
  if (storedTarget && storedTarget !== '5000') {
    initialTarget = parseFloat(storedTarget) || 1000;
  } else {
    localStorage.setItem('mt5_monthly_income_target', '1000');
  }
  const [monthlyIncomeTarget, setMonthlyIncomeTargetSignal] = createSignal<number>(initialTarget);

  const setMonthlyIncomeTarget = (val: number) => {
    if (!isNaN(val) && val > 0) {
      setMonthlyIncomeTargetSignal(val);
      localStorage.setItem('mt5_monthly_income_target', val.toString());
    }
  };

  const setMinRiskFloorPct = (val: number) => {
    if (!isNaN(val) && val > 0) {
      setMinRiskFloorPctSignal(val);
      localStorage.setItem('mt5_min_risk_floor', val.toString());
    }
  };

  const setMaxRiskCeilingPct = (val: number) => {
    if (!isNaN(val) && val > 0) {
      setMaxRiskCeilingPctSignal(val);
      localStorage.setItem('mt5_max_risk_ceiling', val.toString());
    }
  };

  const [slMode, setSlModeSignal] = createSignal<string>(
    localStorage.getItem('mt5_risk_sl_mode') || '1/4 ADR'
  );
  const [rrRatio, setRrRatioSignal] = createSignal<number>(
    parseFloat(localStorage.getItem('mt5_risk_rr_ratio') || '1.5') || 1.5
  );
  const [turboMode, setTurboModeSignal] = createSignal<boolean>(
    localStorage.getItem('mt5_turbo_mode') === 'true'
  );
  const [oneClickEnabled, setOneClickEnabledSignal] = createSignal<boolean>(
    localStorage.getItem('mt5_risk_one_click') === 'true'
  );
  const [activeView, setActiveViewSignal] = createSignal<'matrix' | 'positions'>(
    (localStorage.getItem('mt5_active_view') as 'matrix' | 'positions') || 'matrix'
  );

  const setActiveView = (view: 'matrix' | 'positions') => {
    setActiveViewSignal(view);
    localStorage.setItem('mt5_active_view', view);
  };

  const initialPnlMode =
    (localStorage.getItem('mt5_pnl_display_mode') as 'currency' | 'r_multiple' | 'stealth_mask') || 'currency';
  const [pnlDisplayMode, setPnlDisplayModeSignal] = createSignal<'currency' | 'r_multiple' | 'stealth_mask'>(initialPnlMode);

  const cyclePnlDisplayMode = () => {
    const current = pnlDisplayMode();
    let next: 'currency' | 'r_multiple' | 'stealth_mask';
    if (current === 'currency') next = 'r_multiple';
    else if (current === 'r_multiple') next = 'stealth_mask';
    else next = 'currency';

    setPnlDisplayModeSignal(next);
    localStorage.setItem('mt5_pnl_display_mode', next);
    return next;
  };

  const setPnlDisplayMode = (mode: 'currency' | 'r_multiple' | 'stealth_mask') => {
    setPnlDisplayModeSignal(mode);
    localStorage.setItem('mt5_pnl_display_mode', mode);
  };

  const initialColorway = (localStorage.getItem('mt5_colorway') as 'standard' | 'cvd') || 'standard';
  const [colorway, setColorwaySignal] = createSignal<'standard' | 'cvd'>(initialColorway);

  // Initialize data-colorway attribute on html root
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-colorway', initialColorway);
  }

  const setColorway = (val: 'standard' | 'cvd') => {
    setColorwaySignal(val);
    localStorage.setItem('mt5_colorway', val);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-colorway', val);
    }
  };

  const toggleColorway = () => {
    const next = colorway() === 'standard' ? 'cvd' : 'standard';
    setColorway(next);
    return next;
  };

  const [showStatsBanner, setShowStatsBannerSignal] = createSignal<boolean>(
    localStorage.getItem('mt5_show_stats_banner') === 'true'
  );
  const [pinnedSymbols, setPinnedSymbolsSignal] = createSignal<string[]>(
    JSON.parse(localStorage.getItem('mt5_pinned_symbols') || '[]')
  );
  const [customOrder, setCustomOrderSignal] = createSignal<string[]>(
    JSON.parse(localStorage.getItem('mt5_custom_symbol_order') || '[]')
  );
  const storedSlOverrides = (() => {
    try {
      return JSON.parse(localStorage.getItem('mt5_sl_overrides') || '{}');
    } catch {
      return {};
    }
  })();
  const [slOverrides, setSlOverridesSignal] = createSignal<Record<string, number>>(storedSlOverrides);
  const [defaultSltpFocusField, setDefaultSltpFocusFieldSignal] = createSignal<'price' | 'pips' | 'cash'>(
    (localStorage.getItem('mt5_sltp_default_focus') as 'price' | 'pips' | 'cash') || 'price'
  );

  const setDefaultSltpFocusField = (val: 'price' | 'pips' | 'cash') => {
    setDefaultSltpFocusFieldSignal(val);
    localStorage.setItem('mt5_sltp_default_focus', val);
  };

  const setRiskMethod = (val: string) => {
    setRiskMethodSignal(val);
    localStorage.setItem('mt5_risk_method', val);
  };

  const setCustomRiskPct = (val: number) => {
    setCustomRiskPctSignal(val);
    localStorage.setItem('mt5_risk_custom_pct', val.toString());
  };

  const setSlMode = (val: string) => {
    setSlModeSignal(val);
    localStorage.setItem('mt5_risk_sl_mode', val);
  };

  const setRrRatio = (val: number) => {
    setRrRatioSignal(val);
    localStorage.setItem('mt5_risk_rr_ratio', val.toString());
  };

  const toggleTurboMode = () => {
    const next = !turboMode();
    setTurboModeSignal(next);
    localStorage.setItem('mt5_turbo_mode', next ? 'true' : 'false');
    return next;
  };

  const toggleOneClick = () => {
    const next = !oneClickEnabled();
    setOneClickEnabledSignal(next);
    localStorage.setItem('mt5_risk_one_click', next ? 'true' : 'false');
  };

  const setOneClickEnabled = (val: boolean) => {
    setOneClickEnabledSignal(val);
    localStorage.setItem('mt5_risk_one_click', val ? 'true' : 'false');
  };

  const toggleStatsBanner = () => {
    const next = !showStatsBanner();
    setShowStatsBannerSignal(next);
    localStorage.setItem('mt5_show_stats_banner', next ? 'true' : 'false');
  };

  const togglePin = (symbol: string) => {
    const current = pinnedSymbols();
    let updated: string[];
    if (current.includes(symbol)) {
      updated = current.filter((s) => s !== symbol);
    } else {
      updated = [...current, symbol];
    }
    setPinnedSymbolsSignal(updated);
    localStorage.setItem('mt5_pinned_symbols', JSON.stringify(updated));
  };

  const isPinned = (symbol: string) => pinnedSymbols().includes(symbol);

  const setCustomOrder = (order: string[]) => {
    setCustomOrderSignal(order);
    localStorage.setItem('mt5_custom_symbol_order', JSON.stringify(order));
  };

  const resetCustomOrder = () => {
    setCustomOrderSignal([]);
    setPinnedSymbolsSignal([]);
    localStorage.removeItem('mt5_custom_symbol_order');
    localStorage.removeItem('mt5_pinned_symbols');
  };

  const setSymbolSL = (symbol: string, pips: number) => {
    setSlOverridesSignal((prev) => {
      const next = { ...prev, [symbol]: pips };
      localStorage.setItem('mt5_sl_overrides', JSON.stringify(next));
      return next;
    });
  };

  const resetSymbolSL = (symbol: string) => {
    setSlOverridesSignal((prev) => {
      const next = { ...prev };
      delete next[symbol];
      localStorage.setItem('mt5_sl_overrides', JSON.stringify(next));
      return next;
    });
  };

  return {
    workingCapital,
    reserveDelta,
    isWorkingCapitalCustom,
    setWorkingCapital,
    resetWorkingCapital,
    riskMethod,
    setRiskMethod,
    customRiskPct,
    setCustomRiskPct,
    monthlyIncomeTarget,
    setMonthlyIncomeTarget,
    minRiskFloorPct,
    setMinRiskFloorPct,
    maxRiskCeilingPct,
    setMaxRiskCeilingPct,
    slMode,
    setSlMode,
    rrRatio,
    setRrRatio,
    turboMode,
    toggleTurboMode,
    oneClickEnabled,
    toggleOneClick,
    setOneClickEnabled,
    activeView,
    setActiveView,
    pnlDisplayMode,
    cyclePnlDisplayMode,
    setPnlDisplayMode,
    colorway,
    setColorway,
    toggleColorway,
    showStatsBanner,
    toggleStatsBanner,
    pinnedSymbols,
    togglePin,
    isPinned,
    customOrder,
    setCustomOrder,
    resetCustomOrder,
    defaultSltpFocusField,
    setDefaultSltpFocusField,
    slOverrides,
    setSymbolSL,
    resetSymbolSL,
  };
}

export const preferencesStore = createRoot(createPreferences);
