import { Data } from 'effect';

// Typed TWSE MIS boundary failures. Same safety rule as Fugle errors: no
// response body, no headers, no raw causes travel in the error channel.
export class TwseMisNetworkError extends Data.TaggedError('TwseMisNetworkError') {}

export class TwseMisTimeoutError extends Data.TaggedError('TwseMisTimeoutError') {}

export class TwseMisHttpError extends Data.TaggedError('TwseMisHttpError')<{
  readonly status: number;
}> {}

export class TwseMisDecodeError extends Data.TaggedError('TwseMisDecodeError')<{
  readonly stage: 'json' | 'schema' | 'value';
}> {}

export type TwseMisQuoteError =
  | TwseMisNetworkError
  | TwseMisTimeoutError
  | TwseMisHttpError
  | TwseMisDecodeError;
