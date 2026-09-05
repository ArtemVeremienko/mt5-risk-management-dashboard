import { AccountSummary, OpenPosition, TradeStats, SampleSizeInfo, SymbolSpec } from '../types';
import { httpClient, ApiError } from './httpClient';

export interface ExecuteOrderPayload {
  symbol: string;
  action: 'BUY' | 'SELL';
  volume: number;
  sl_pips: number;
  rr_ratio: number;
  comment?: string;
  client_order_id?: string;
  bypass_spread_guard?: boolean;
}

export interface CalculateApiPayload {
  working_capital: number;
  deposited_cash: number;
  leverage: number;
  risk_method: string;
  custom_risk_pct: number;
  global_sl_mode: string;
  global_sl_pips: number;
  symbol_sl_overrides: Record<string, number>;
}

export interface OrderActionResult {
  success: boolean;
  message: string;
  ticket?: number;
  [key: string]: any;
}

export const api = {
  fetchAccount(): Promise<AccountSummary> {
    return httpClient.get<AccountSummary>('/api/account');
  },

  fetchTradeHistory(): Promise<{
    stats: TradeStats;
    sample_info: SampleSizeInfo;
    twr_curve?: Array<{ f: number; twr: number }>;
    recent_trades?: any[];
  }> {
    return httpClient.get('/api/trade-history');
  },

  fetchInitialCalculate(payload: CalculateApiPayload): Promise<{
    results: Array<{ spec: SymbolSpec }>;
    trade_stats: TradeStats;
  }> {
    return httpClient.post('/api/calculate', payload);
  },

  async executeOrder(payload: ExecuteOrderPayload): Promise<OrderActionResult> {
    try {
      const res = await httpClient.post<OrderActionResult>('/api/order/execute', payload);
      return res;
    } catch (err: any) {
      return {
        success: false,
        message: err instanceof ApiError ? err.message : (err?.message || 'Failed to execute order'),
      };
    }
  },

  fetchPositions(): Promise<{ positions: OpenPosition[]; count: number }> {
    return httpClient.get<{ positions: OpenPosition[]; count: number }>('/api/positions');
  },

  async closePosition(ticket: number, volume?: number): Promise<OrderActionResult> {
    try {
      const res = await httpClient.post<OrderActionResult>('/api/position/close', { ticket, volume });
      return res;
    } catch (err: any) {
      return {
        success: false,
        message: err instanceof ApiError ? err.message : (err?.message || `Failed to close position #${ticket}`),
      };
    }
  },

  async modifyPosition(ticket: number, sl?: number, tp?: number): Promise<OrderActionResult> {
    try {
      const res = await httpClient.post<OrderActionResult>('/api/position/modify', { ticket, sl, tp });
      return res;
    } catch (err: any) {
      return {
        success: false,
        message: err instanceof ApiError ? err.message : (err?.message || `Failed to modify position #${ticket}`),
      };
    }
  },

  closeAllPositions(): Promise<{ results: Array<{ success: boolean; message: string }>; count: number }> {
    return httpClient.post('/api/position/close-all');
  },

  flattenAll(): Promise<{
    success: boolean;
    orders_cancelled: number;
    positions_closed: number;
    order_results: Array<{ success: boolean; message?: string }>;
    position_results: Array<{ success: boolean; message?: string }>;
    message: string;
    timestamp: number;
  }> {
    return httpClient.post('/api/position/flatten-all');
  },

  cancelAllOrders(): Promise<{
    success: boolean;
    cancelled_count: number;
    total_count: number;
    results: Array<{ success: boolean; message?: string }>;
  }> {
    return httpClient.post('/api/order/cancel-all');
  },

  breakEvenAllPositions(): Promise<{
    success: boolean;
    count_modified: number;
    count_skipped: number;
    total_positions: number;
    results: Array<any>;
  }> {
    return httpClient.post('/api/position/break-even-all');
  },

  close50AllPositions(): Promise<{
    success: boolean;
    count_scaled_out: number;
    count_be_locked: number;
    count_skipped: number;
    total_positions: number;
    results: Array<any>;
  }> {
    return httpClient.post('/api/position/close-50-all');
  },

  submitManualStats(params: {
    win_rate: number;
    payoff_ratio: number;
    total_trades: number;
    worst_loss: number;
  }): Promise<TradeStats> {
    return httpClient.post<TradeStats>('/api/manual-stats', params);
  },

  uploadTradesCsv(file: File): Promise<{ message: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return httpClient.upload<{ message: string }>('/api/upload-trades', formData);
  },
};

