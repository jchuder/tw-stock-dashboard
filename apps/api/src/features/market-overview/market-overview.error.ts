import { Data } from 'effect';

export class TwseMarketError extends Data.TaggedError('TwseMarketError')<{
  readonly cause?: unknown;
}> {
  constructor(args?: { readonly cause?: unknown }) {
    super(args as { readonly cause?: unknown });
  }
}

export class TpexMarketError extends Data.TaggedError('TpexMarketError')<{
  readonly cause?: unknown;
}> {
  constructor(args?: { readonly cause?: unknown }) {
    super(args as { readonly cause?: unknown });
  }
}

export class InstitutionalFlowError extends Data.TaggedError('InstitutionalFlowError')<{
  readonly cause?: unknown;
}> {
  constructor(args?: { readonly cause?: unknown }) {
    super(args as { readonly cause?: unknown });
  }
}

export type MarketOverviewError = TwseMarketError | TpexMarketError | InstitutionalFlowError;
