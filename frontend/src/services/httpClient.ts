/**
 * Lightweight, zero-dependency HTTP client abstraction.
 * Provides fluent methods, automatic JSON serialization/deserialization,
 * standardized FastAPI error parsing, and configurable request timeouts.
 */

export class ApiError extends Error {
  status: number;
  statusText: string;
  data: any;

  constructor(status: number, statusText: string, message: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.data = data;
  }
}

export interface HttpRequestOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Extracts a human-friendly error string from FastAPI/broker JSON error payloads.
 */
function extractErrorMessage(status: number, statusText: string, data: any): string {
  if (data && typeof data === 'object') {
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message;
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      return data.error;
    }
    if (typeof data.detail === 'string' && data.detail.trim()) {
      return data.detail;
    }
    // FastAPI validation errors: [{"loc": ["body", "param"], "msg": "field required"}]
    if (Array.isArray(data.detail) && data.detail.length > 0) {
      const first = data.detail[0];
      if (typeof first === 'object' && first?.msg) {
        const field = Array.isArray(first.loc) ? first.loc.slice(1).join('.') : '';
        return field ? `${field}: ${first.msg}` : first.msg;
      }
      return JSON.stringify(data.detail);
    }
  }
  return statusText || `HTTP error ${status}`;
}

async function request<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const { timeoutMs = 10000, ...fetchOptions } = options;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  if (fetchOptions.signal) {
    fetchOptions.signal.addEventListener('abort', () => controller.abort());
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    if (!res.ok) {
      let errData: any;
      try {
        errData = await res.json();
      } catch {
        try {
          errData = await res.text();
        } catch {
          errData = null;
        }
      }
      const message = extractErrorMessage(res.status, res.statusText, errData);
      throw new ApiError(res.status, res.statusText, message, errData);
    }

    if (res.status === 204) {
      return undefined as unknown as T;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }

    return (await res.text()) as unknown as T;
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    if (err?.name === 'AbortError') {
      throw new ApiError(0, 'Aborted', err.message || 'Request was cancelled', err);
    }
    throw new ApiError(0, 'NetworkError', err?.message || 'Network request failed', err);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const httpClient = {
  get<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    return request<T>(url, { ...options, method: 'GET' });
  },

  post<T>(url: string, body?: any, options?: HttpRequestOptions): Promise<T> {
    const headers = new Headers(options?.headers);
    if (body !== undefined && !(body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const formattedBody =
      body === undefined || body instanceof FormData
        ? body
        : typeof body === 'string'
          ? body
          : JSON.stringify(body);

    return request<T>(url, {
      ...options,
      method: 'POST',
      headers,
      body: formattedBody,
    });
  },

  put<T>(url: string, body?: any, options?: HttpRequestOptions): Promise<T> {
    const headers = new Headers(options?.headers);
    if (body !== undefined && !(body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const formattedBody =
      body === undefined || body instanceof FormData
        ? body
        : typeof body === 'string'
          ? body
          : JSON.stringify(body);

    return request<T>(url, {
      ...options,
      method: 'PUT',
      headers,
      body: formattedBody,
    });
  },

  delete<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    return request<T>(url, { ...options, method: 'DELETE' });
  },

  upload<T>(url: string, formData: FormData, options?: HttpRequestOptions): Promise<T> {
    return request<T>(url, {
      ...options,
      method: 'POST',
      body: formData,
    });
  },
};
