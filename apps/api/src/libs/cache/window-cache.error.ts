export class WindowCoordinationTimeoutError extends Error {
  readonly _tag = 'WindowCoordinationTimeoutError';
  constructor(
    readonly key: string,
    readonly waitedMs: number,
  ) {
    super(`Timed out waiting for a fresh window snapshot for key ${key} after ${waitedMs}ms`);
    this.name = 'WindowCoordinationTimeoutError';
  }
}
