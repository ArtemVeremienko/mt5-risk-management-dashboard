import { createSignal, createMemo, createRoot } from 'solid-js';
import { accountStore } from './accountStore';
import { STORAGE_KEYS } from '../config/constants';

function createPreferences() {
  const savedDeltaStr = localStorage.getItem(STORAGE_KEYS.RESERVE_DELTA);
  let initialDelta: number | null = null;

  if (savedDeltaStr !== null && !isNaN(parseFloat(savedDeltaStr))) {
    initialDelta = parseFloat(savedDeltaStr);
  } else {
    // Migration: Check legacy custom working capital
    const legacyWcStr = localStorage.getItem(STORAGE_KEYS.LEGACY_WORKING_CAPITAL);
    if (legacyWcStr !== null && !isNaN(parseFloat(legacyWcStr))) {
      const legacyTarget = parseFloat(legacyWcStr);
      const curBal = accountStore.account().balance ?? 0;
      initialDelta = Math.max(0, legacyTarget - curBal);
      localStorage.setItem(STORAGE_KEYS.RESERVE_DELTA, initialDelta.toString());
      localStorage.removeItem(STORAGE_KEYS.LEGACY_WORKING_CAPITAL);
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
      localStorage.setItem(STORAGE_KEYS.RESERVE_DELTA, delta.toString());
      localStorage.removeItem(STORAGE_KEYS.LEGACY_WORKING_CAPITAL);
    }
  };

  const resetWorkingCapital = () => {
    localStorage.removeItem(STORAGE_KEYS.RESERVE_DELTA);
    localStorage.removeItem(STORAGE_KEYS.LEGACY_WORKING_CAPITAL);
    setReserveDelta(null);
  };

  const rawRiskMethod = localStorage.getItem(STORAGE_KEYS.RISK_METHOD) || 'fractional';
  const initialRiskMethod = rawRiskMethod === 'kelly_half' ? 'kelly_half' : 'fractional';
  const [riskMethod, setRiskMethodSignal] = createSignal<string>(initialRiskMethod);

  const [customRiskPct, setCustomRiskPctSignal] = createSignal<number>(
    parseFloat(localStorage.getItem(STORAGE_KEYS.CUSTOM_RISK_PCT) || '1.0') || 1.0
  );
  const [minRiskFloorPct, setMinRiskFloorPctSignal] = createSignal<number>(
    parseFloat(localStorage.getItem(STORAGE_KEYS.MIN_RISK_FLOOR) || '0.25') || 0.25
  );
  const [maxRiskCeilingPct, setMaxRiskCeilingPctSignal] = createSignal<number>(
    parseFloat(localStorage.getItem(STORAGE_KEYS.MAX_RISK_CEILING) || '2.50') || 2.50
  );

  const storedTarget = localStorage.getItem(STORAGE_KEYS.MONTHLY_INCOME_TARGET);
  let initialTarget = 1000;
  if (storedTarget && storedTarget !== '5000') {
    initialTarget = parseFloat(storedTarget) || 1000;
  } else {
    localStorage.setItem(STORAGE_KEYS.MONTHLY_INCOME_TARGET, '1000');
  }
  const [monthlyIncomeTarget, setMonthlyIncomeTargetSignal] = createSignal<number>(initialTarget);

  const setMonthlyIncomeTarget = (val: number) => {
    if (!isNaN(val) && val > 0) {
      setMonthlyIncomeTargetSignal(val);
      localStorage.setItem(STORAGE_KEYS.MONTHLY_INCOME_TARGET, val.toString());
    }
  };

  const setMinRiskFloorPct = (val: number) => {
    if (!isNaN(val) && val > 0) {
      setMinRiskFloorPctSignal(val);
      localStorage.setItem(STORAGE_KEYS.MIN_RISK_FLOOR, val.toString());
    }
  };

  const setMaxRiskCeilingPct = (val: number) => {
    if (!isNaN(val) && val > 0) {
      setMaxRiskCeilingPctSignal(val);
      localStorage.setItem(STORAGE_KEYS.MAX_RISK_CEILING, val.toString());
    }
  };

  const [slMode, setSlModeSignal] = createSignal<string>(
    localStorage.getItem(STORAGE_KEYS.SL_MODE) || '1/4 ADR'
  );
  const [rrRatio, setRrRatioSignal] = createSignal<number>(
    parseFloat(localStorage.getItem(STORAGE_KEYS.RR_RATIO) || '1.5') || 1.5
  );
  const [turboMode, setTurboModeSignal] = createSignal<boolean>(
    localStorage.getItem(STORAGE_KEYS.TURBO_MODE) === 'true'
  );
  const [oneClickEnabled, setOneClickEnabledSignal] = createSignal<boolean>(
    localStorage.getItem(STORAGE_KEYS.ONE_CLICK) === 'true'
  );
  const [activeView, setActiveViewSignal] = createSignal<'matrix' | 'positions'>(
    (localStorage.getItem(STORAGE_KEYS.ACTIVE_VIEW) as 'matrix' | 'positions') || 'matrix'
  );

  const setActiveView = (view: 'matrix' | 'positions') => {
    setActiveViewSignal(view);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_VIEW, view);
  };

  const initialPnlMode =
    (localStorage.getItem(STORAGE_KEYS.PNL_DISPLAY_MODE) as 'currency' | 'r_multiple' | 'stealth_mask') || 'currency';
  const [pnlDisplayMode, setPnlDisplayModeSignal] = createSignal<'currency' | 'r_multiple' | 'stealth_mask'>(initialPnlMode);

  const cyclePnlDisplayMode = () => {
    const current = pnlDisplayMode();
    let next: 'currency' | 'r_multiple' | 'stealth_mask';
    if (current === 'currency') next = 'r_multiple';
    else if (current === 'r_multiple') next = 'stealth_mask';
    else next = 'currency';

    setPnlDisplayModeSignal(next);
    localStorage.setItem(STORAGE_KEYS.PNL_DISPLAY_MODE, next);
    return next;
  };

  const setPnlDisplayMode = (mode: 'currency' | 'r_multiple' | 'stealth_mask') => {
    setPnlDisplayModeSignal(mode);
    localStorage.setItem(STORAGE_KEYS.PNL_DISPLAY_MODE, mode);
  };

  const initialColorway = (localStorage.getItem(STORAGE_KEYS.COLORWAY) as 'standard' | 'cvd') || 'standard';
  const [colorway, setColorwaySignal] = createSignal<'standard' | 'cvd'>(initialColorway);

  // Initialize data-colorway attribute on html root
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-colorway', initialColorway);
  }

  const setColorway = (val: 'standard' | 'cvd') => {
    setColorwaySignal(val);
    localStorage.setItem(STORAGE_KEYS.COLORWAY, val);
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
    localStorage.getItem(STORAGE_KEYS.SHOW_STATS_BANNER) === 'true'
  );
  const [pinnedSymbols, setPinnedSymbolsSignal] = createSignal<string[]>(
    JSON.parse(localStorage.getItem(STORAGE_KEYS.PINNED_SYMBOLS) || '[]')
  );
  const [customOrder, setCustomOrderSignal] = createSignal<string[]>(
    JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_SYMBOL_ORDER) || '[]')
  );
  const storedSlOverrides = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.SL_OVERRIDES) || '{}');
    } catch {
      return {};
    }
  })();
  const [slOverrides, setSlOverridesSignal] = createSignal<Record<string, number>>(storedSlOverrides);
  const [defaultSltpFocusField, setDefaultSltpFocusFieldSignal] = createSignal<'price' | 'pips' | 'cash'>(
    (localStorage.getItem(STORAGE_KEYS.SLTP_DEFAULT_FOCUS) as 'price' | 'pips' | 'cash') || 'price'
  );

  const setDefaultSltpFocusField = (val: 'price' | 'pips' | 'cash') => {
    setDefaultSltpFocusFieldSignal(val);
    localStorage.setItem(STORAGE_KEYS.SLTP_DEFAULT_FOCUS, val);
  };

  const setRiskMethod = (val: string) => {
    setRiskMethodSignal(val);
    localStorage.setItem(STORAGE_KEYS.RISK_METHOD, val);
  };

  const setCustomRiskPct = (val: number) => {
    setCustomRiskPctSignal(val);
    localStorage.setItem(STORAGE_KEYS.CUSTOM_RISK_PCT, val.toString());
  };

  const setSlMode = (val: string) => {
    setSlModeSignal(val);
    localStorage.setItem(STORAGE_KEYS.SL_MODE, val);
  };

  const setRrRatio = (val: number) => {
    setRrRatioSignal(val);
    localStorage.setItem(STORAGE_KEYS.RR_RATIO, val.toString());
  };

  const toggleTurboMode = () => {
    const next = !turboMode();
    setTurboModeSignal(next);
    localStorage.setItem(STORAGE_KEYS.TURBO_MODE, next ? 'true' : 'false');
    return next;
  };

  const toggleOneClick = () => {
    const next = !oneClickEnabled();
    setOneClickEnabledSignal(next);
    localStorage.setItem(STORAGE_KEYS.ONE_CLICK, next ? 'true' : 'false');
  };

  const setOneClickEnabled = (val: boolean) => {
    setOneClickEnabledSignal(val);
    localStorage.setItem(STORAGE_KEYS.ONE_CLICK, val ? 'true' : 'false');
  };

  const toggleStatsBanner = () => {
    const next = !showStatsBanner();
    setShowStatsBannerSignal(next);
    localStorage.setItem(STORAGE_KEYS.SHOW_STATS_BANNER, next ? 'true' : 'false');
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
    localStorage.setItem(STORAGE_KEYS.PINNED_SYMBOLS, JSON.stringify(updated));
  };

  const isPinned = (symbol: string) => pinnedSymbols().includes(symbol);

  const setCustomOrder = (order: string[]) => {
    setCustomOrderSignal(order);
    localStorage.setItem(STORAGE_KEYS.CUSTOM_SYMBOL_ORDER, JSON.stringify(order));
  };

  const resetCustomOrder = () => {
    setCustomOrderSignal([]);
    setPinnedSymbolsSignal([]);
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_SYMBOL_ORDER);
    localStorage.removeItem(STORAGE_KEYS.PINNED_SYMBOLS);
  };

  const setSymbolSL = (symbol: string, pips: number) => {
    setSlOverridesSignal((prev) => {
      const next = { ...prev, [symbol]: pips };
      localStorage.setItem(STORAGE_KEYS.SL_OVERRIDES, JSON.stringify(next));
      return next;
    });
  };

  const resetSymbolSL = (symbol: string) => {
    setSlOverridesSignal((prev) => {
      const next = { ...prev };
      delete next[symbol];
      localStorage.setItem(STORAGE_KEYS.SL_OVERRIDES, JSON.stringify(next));
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
