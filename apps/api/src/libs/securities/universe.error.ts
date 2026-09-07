import { Data } from 'effect';

// Raised when no successful universe source contains the symbol and every
// required source completed: the symbol genuinely does not exist in the
// supported universe (TWSE/TPEX/ESB common stocks, TWSE/TPEX ETFs).
export class StockNotFoundError extends Data.TaggedError('StockNotFoundError') {}

// Raised when the symbol is absent but at least one required universe source
// failed: absence is inconclusive, so it must never degrade into a 404.
// Maps to HTTP 503; a last-known-good cached universe is preferred first.
export class UniverseUnavailableError extends Data.TaggedError('UniverseUnavailableError') {}
