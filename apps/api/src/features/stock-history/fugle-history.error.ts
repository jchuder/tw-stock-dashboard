import { Data } from 'effect';

// Typed Fugle historical-candles boundary failures. Same narrow rule as the
// quote slice: no API key, no headers, no bodies, no raw causes travel.
export class FugleHistoryConfigError extends Data.TaggedError('FugleHistoryConfigError') {}

export class FugleHistoryNetworkError extends Data.TaggedError('FugleHistoryNetworkError') {}

export class FugleHistoryTimeoutError extends Data.TaggedError('FugleHistoryTimeoutError') {}

export class FugleHistoryHttpError extends Data.TaggedError('FugleHistoryHttpError')<{
  readonly status: number;
}> {}

export class FugleHistoryDecodeError extends Data.TaggedError('FugleHistoryDecodeError') {}

export type FugleHistoryError =
  | FugleHistoryConfigError
  | FugleHistoryNetworkError
  | FugleHistoryTimeoutError
  | FugleHistoryHttpError
  | FugleHistoryDecodeError;
