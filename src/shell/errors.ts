export class ShellError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ShellError";
  }
}

export function toShellError(error: unknown): ShellError {
  if (error instanceof ShellError) {
    return error;
  }

  if (error instanceof Error) {
    return new ShellError("internal_error", error.message);
  }

  return new ShellError("internal_error", "Unknown error");
}
