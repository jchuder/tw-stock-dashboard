import { trace } from '@opentelemetry/api';
import type { Attributes, Span } from '@opentelemetry/api';

// Thin active-span accessors for domain telemetry. No SDK, no provider, no
// tracer instance lives here: without a registered SDK these calls no-op, so
// plain `pnpm start` and unit tests behave exactly as before. Callers must
// never put secrets, headers, bodies, or raw causes into attributes.
export function activeSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export function setSpanAttributes(attributes: Attributes): void {
  activeSpan()?.setAttributes(attributes);
}

export function addSpanEvent(name: string, attributes?: Attributes): void {
  activeSpan()?.addEvent(name, attributes);
}
