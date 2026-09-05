import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpClient, ApiError } from './httpClient';

describe('httpClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET requests', () => {
    it('successfully parses JSON responses', async () => {
      const mockData = { balance: 10000, equity: 10250 };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => mockData,
      } as Response);

      const result = await httpClient.get<typeof mockData>('/api/account');
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/account',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns empty result for 204 No Content', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
      } as Response);

      const result = await httpClient.get('/api/empty');
      expect(result).toBeUndefined();
    });
  });

  describe('POST / PUT requests and body serialization', () => {
    it('automatically sets Content-Type to application/json and serializes body', async () => {
      const payload = { symbol: 'EURUSD', action: 'BUY', volume: 0.5 };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ success: true, ticket: 12345 }),
      } as Response);

      const result = await httpClient.post('/api/order/execute', payload);
      expect(result).toEqual({ success: true, ticket: 12345 });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/order/execute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      );
      const callHeaders = (global.fetch as any).mock.calls[0][1].headers as Headers;
      expect(callHeaders.get('Content-Type')).toBe('application/json');
    });

    it('handles PUT requests with payload serialization', async () => {
      const payload = { ticket: 123, sl: 1.085 };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ success: true }),
      } as Response);

      await httpClient.put('/api/position/modify', payload);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/position/modify',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      );
    });

    it('supports DELETE requests', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ success: true }),
      } as Response);

      await httpClient.delete('/api/order/cancel');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/order/cancel',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('FormData file upload', () => {
    it('sends FormData directly without forcing application/json Content-Type', async () => {
      const formData = new FormData();
      formData.append('file', 'dummy-data');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ message: 'Uploaded' }),
      } as Response);

      const res = await httpClient.upload('/api/upload-trades', formData);
      expect(res).toEqual({ message: 'Uploaded' });

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].body).toBe(formData);
      expect(fetchCall[1].headers?.get?.('Content-Type')).toBeFalsy();
    });
  });

  describe('FastAPI & HTTP Error Handling', () => {
    it('extracts "message" string from JSON errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ success: false, message: 'Invalid lot size' }),
      } as Response);

      await expect(httpClient.get('/api/test')).rejects.toThrow('Invalid lot size');
      try {
        await httpClient.get('/api/test');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(400);
        expect(e.message).toBe('Invalid lot size');
      }
    });

    it('extracts "error" string from JSON errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ success: false, error: 'Spread blowout limit exceeded' }),
      } as Response);

      await expect(httpClient.get('/api/test')).rejects.toThrow('Spread blowout limit exceeded');
    });

    it('extracts "detail" string from FastAPI errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ detail: 'Position not found' }),
      } as Response);

      await expect(httpClient.get('/api/test')).rejects.toThrow('Position not found');
    });

    it('extracts FastAPI validation error array detail cleanly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({
          detail: [
            { loc: ['body', 'volume'], msg: 'field required', type: 'value_error.missing' },
          ],
        }),
      } as Response);

      await expect(httpClient.get('/api/test')).rejects.toThrow('volume: field required');
    });

    it('falls back to statusText or generic HTTP error on text response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'Content-Type': 'text/html' }),
        json: async () => {
          throw new Error('Not JSON');
        },
        text: async () => '<html>502 Bad Gateway</html>',
      } as Response);

      try {
        await httpClient.get('/api/test');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(502);
        expect(e.message).toBe('Bad Gateway');
      }
    });

    it('handles network failure (offline / fetch reject)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

      try {
        await httpClient.get('/api/test');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(0);
        expect(e.statusText).toBe('NetworkError');
        expect(e.message).toBe('Failed to fetch');
      }
    });
  });
});
