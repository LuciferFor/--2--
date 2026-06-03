export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "BUNGIE_ERROR"
  | "CONFIG_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(404, "NOT_FOUND", message, details);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, "UPSTREAM_ERROR", message, details);
  }
}

export class BungiePlatformError extends AppError {
  constructor(
    message: string,
    public readonly bungieErrorCode: number,
    public readonly bungieErrorStatus: string,
    details?: unknown
  ) {
    super(502, "BUNGIE_ERROR", message, details);
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(500, "INTERNAL_ERROR", error.message);
  }

  return new AppError(500, "INTERNAL_ERROR", "Unknown error");
}
