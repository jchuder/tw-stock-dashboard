import { Data } from 'effect';

// Domain error representing an invalid or non-existent stock symbol.
// Raised when the primary upstream provider returns HTTP 404.
export class StockNotFoundError extends Data.TaggedError('StockNotFoundError') {}
