import { createSignal, createRoot, createMemo } from 'solid-js';
import { OpenPosition } from '../types';
import { calculatePortfolioHeat, calculateNetCurrencyExposure, normalizeCashToR } from '../utils/portfolioAnalytics';
import { marketStore } from './marketStore';
import { preferencesStore } from './preferencesStore';

function createPositionsStore() {
  const [positions, setPositions] = createSignal<OpenPosition[]>([]);
  const [isActionInProgress, setIsActionInProgress] = createSignal<boolean>(false);

  const positionsMap = createMemo<Map<number, OpenPosition>>(() => {
    const map = new Map<number, OpenPosition>();
    for (const p of positions()) {
      map.set(p.ticket, p);
    }
    return map;
  });

  const positionTickets = createMemo<number[]>(() => {
    return positions().map((p) => p.ticket);
  });

  const getPosition = (ticket: number): OpenPosition | undefined => {
    return positionsMap().get(ticket);
  };

  const totalFloatingProfit = createMemo(() => {
    return positions().reduce((acc, p) => acc + (p.profit || 0), 0);
  });

  const totalPositionsCount = createMemo(() => positions().length);

  const portfolioHeat = createMemo(() => {
    return calculatePortfolioHeat(
      positions(),
      (sym) => marketStore.getCalculatedResult(sym),
      preferencesStore.workingCapital()
    );
  });

  const oneRCash = createMemo(() => {
    const wc = preferencesStore.workingCapital();
    const pct = preferencesStore.customRiskPct();
    const safeWc = wc > 0 ? wc : 100.0;
    const safePct = pct > 0 ? pct : 1.0;
    return safeWc * (safePct / 100.0);
  });

  const totalFloatingR = createMemo(() => {
    return normalizeCashToR(
      totalFloatingProfit(),
      preferencesStore.workingCapital(),
      preferencesStore.customRiskPct()
    );
  });

  const portfolioHeatR = createMemo(() => {
    return normalizeCashToR(
      portfolioHeat().totalHeatAmount,
      preferencesStore.workingCapital(),
      preferencesStore.customRiskPct()
    );
  });

  const netCurrencyExposure = createMemo(() => {
    return calculateNetCurrencyExposure(positions());
  });

  return {
    positions,
    setPositions,
    positionsMap,
    positionTickets,
    getPosition,
    totalFloatingProfit,
    totalPositionsCount,
    portfolioHeat,
    oneRCash,
    totalFloatingR,
    portfolioHeatR,
    netCurrencyExposure,
    isActionInProgress,
    setIsActionInProgress,
  };
}

export const positionsStore = createRoot(createPositionsStore);


