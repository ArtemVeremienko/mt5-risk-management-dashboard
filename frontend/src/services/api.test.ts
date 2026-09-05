import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { httpClient, ApiError } from './httpClient';

describe('api service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queries (throwing ApiError on failure)', () => {
    it('fetchAccount calls GET /api/account', async () => {
      const mockAcc = { balance: 5000, equity: 5120, leverage: 100 } as any;
      vi.spyOn(httpClient, 'get').mockResolvedValueOnce(mockAcc);

      const res = await api.fetchAccount();
      expect(res).toEqual(mockAcc);
      expect(httpClient.get).toHaveBeenCalledWith('/api/account');
    });

    it('fetchPositions calls GET /api/positions', async () => {
      const mockPositions = { positions: [{ ticket: 101, symbol: 'EURUSD' }], count: 1 } as any;
      vi.spyOn(httpClient, 'get').mockResolvedValueOnce(mockPositions);

      const res = await api.fetchPositions();
      expect(res).toEqual(mockPositions);
      expect(httpClient.get).toHaveBeenCalledWith('/api/positions');
    });

    it('propagates ApiError when query fails', async () => {
      vi.spyOn(httpClient, 'get').mockRejectedValueOnce(
        new ApiError(500, 'Internal Server Error', 'Database offline')
      );

      await expect(api.fetchAccount()).rejects.toThrow('Database offline');
    });
  });

  describe('trade & order mutations (returning safe domain results)', () => {
    it('executeOrder returns successful broker result', async () => {
      const mockResponse = { success: true, message: 'Executed BUY 0.5 lot', ticket: 9988 };
      vi.spyOn(httpClient, 'post').mockResolvedValueOnce(mockResponse);

      const res = await api.executeOrder({
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 0.5,
        sl_pips: 20,
        rr_ratio: 1.5,
      });

      expect(res).toEqual(mockResponse);
      expect(httpClient.post).toHaveBeenCalledWith('/api/order/execute', expect.any(Object));
    });

    it('executeOrder handles network drop or HTTP error gracefully without throwing', async () => {
      vi.spyOn(httpClient, 'post').mockRejectedValueOnce(
        new ApiError(500, 'Internal Server Error', 'Spread blowout detected')
      );

      const res = await api.executeOrder({
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 0.5,
        sl_pips: 20,
        rr_ratio: 1.5,
      });

      expect(res).toEqual({
        success: false,
        message: 'Spread blowout detected',
      });
    });

    it('closePosition returns successful result', async () => {
      const mockResponse = { success: true, message: 'Position closed' };
      vi.spyOn(httpClient, 'post').mockResolvedValueOnce(mockResponse);

      const res = await api.closePosition(101, 0.5);
      expect(res).toEqual(mockResponse);
      expect(httpClient.post).toHaveBeenCalledWith('/api/position/close', { ticket: 101, volume: 0.5 });
    });

    it('closePosition handles HTTP error gracefully', async () => {
      vi.spyOn(httpClient, 'post').mockRejectedValueOnce(
        new ApiError(404, 'Not Found', 'Position #101 does not exist')
      );

      const res = await api.closePosition(101);
      expect(res).toEqual({
        success: false,
        message: 'Position #101 does not exist',
      });
    });

    it('modifyPosition returns successful result', async () => {
      const mockResponse = { success: true, message: 'SL/TP modified' };
      vi.spyOn(httpClient, 'post').mockResolvedValueOnce(mockResponse);

      const res = await api.modifyPosition(101, 1.085, 1.095);
      expect(res).toEqual(mockResponse);
      expect(httpClient.post).toHaveBeenCalledWith('/api/position/modify', { ticket: 101, sl: 1.085, tp: 1.095 });
    });

    it('modifyPosition handles network errors safely', async () => {
      vi.spyOn(httpClient, 'post').mockRejectedValueOnce(
        new ApiError(0, 'NetworkError', 'Failed to reach MT5 terminal')
      );

      const res = await api.modifyPosition(101, 1.085, 1.095);
      expect(res).toEqual({
        success: false,
        message: 'Failed to reach MT5 terminal',
      });
    });
  });

  describe('bulk liquidation & utility endpoints', () => {
    it('flattenAll dispatches POST to /api/position/flatten-all', async () => {
      const mockSummary = { success: true, positions_closed: 3, orders_cancelled: 1 } as any;
      vi.spyOn(httpClient, 'post').mockResolvedValueOnce(mockSummary);

      const res = await api.flattenAll();
      expect(res).toEqual(mockSummary);
      expect(httpClient.post).toHaveBeenCalledWith('/api/position/flatten-all');
    });

    it('uploadTradesCsv calls httpClient.upload with FormData', async () => {
      const mockFile = new File(['mock content'], 'history.csv', { type: 'text/csv' });
      vi.spyOn(httpClient, 'upload').mockResolvedValueOnce({ message: 'Uploaded 50 trades' });

      const res = await api.uploadTradesCsv(mockFile);
      expect(res).toEqual({ message: 'Uploaded 50 trades' });
      expect(httpClient.upload).toHaveBeenCalledWith('/api/upload-trades', expect.any(FormData));
    });
  });
});
