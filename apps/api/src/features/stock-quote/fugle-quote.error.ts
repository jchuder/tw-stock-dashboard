import { Data } from 'effect';

// Typed Fugle boundary failures. Deliberately narrow: no API key,
// no authorization, no upstream body/headers/options, no raw causes.
// Q3 fallback only needs `status` off FugleHttpError; nothing else travels.
export class FugleConfigError extends Data.TaggedError('FugleConfigError') {}

export class FugleNetworkError extends Data.TaggedError('FugleNetworkError') {}

export class FugleHttpError extends Data.TaggedError('FugleHttpError')<{
  readonly status: number;
}> {}

export class FugleDecodeError extends Data.TaggedError('FugleDecodeError')<{
  readonly stage: 'json' | 'schema';
}> {}

export type FugleQuoteError = FugleConfigError | FugleNetworkError | FugleHttpError | FugleDecodeError;
