/** A model provider failed to produce a usable response. `retryable` means a plain resend is likely to work. */
export class ModelError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly detail = "",
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export const isRetryableStatus = (status: number): boolean => status === 408 || status === 409 || status === 429 || status >= 500;
