export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnipileError extends ApiError {
  constructor(
    status: number,
    public errorType: string,
    message: string,
    public raw?: unknown,
  ) {
    super(status, message, raw);
    this.name = "UnipileError";
  }

  isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  isLimitError(): boolean {
    return this.errorType.includes("limit_exceeded") || this.errorType.includes("cannot_resend");
  }

  isDisconnected(): boolean {
    return this.errorType.includes("disconnected");
  }

  isNotFound(): boolean {
    return (
      this.status === 404 ||
      this.errorType.includes("not_found") ||
      /not found/i.test(`${this.errorType} ${this.message}`)
    );
  }
}
