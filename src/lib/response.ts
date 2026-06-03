export interface ApiMeta {
  cacheHit?: boolean;
  ttlSeconds?: number;
  tookMs?: number;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, meta: ApiMeta = {}): ApiSuccess<T> {
  return {
    success: true,
    data,
    error: null,
    meta
  };
}

export function fail(code: string, message: string, details?: unknown, meta: ApiMeta = {}): ApiFailure {
  return {
    success: false,
    data: null,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    },
    meta
  };
}
