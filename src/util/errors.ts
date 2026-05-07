export class KimiApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "KimiApiError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function isCloudQuotaExhaustedError(err: unknown): err is KimiApiError {
  return (
    err instanceof KimiApiError &&
    err.httpStatus === 429 &&
    /token quota exhausted/i.test(err.message)
  );
}
