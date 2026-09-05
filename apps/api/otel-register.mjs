// Zero-code OpenTelemetry bootstrap for the API (Q6b). Loaded via:
//   node --experimental-loader=@opentelemetry/instrumentation/hook.mjs \
//        --import ./otel-register.mjs dist/main.js
// (`pnpm start:otel`). Plain `pnpm start` never touches this file, so the
// API runs identically with telemetry unavailable or unconfigured.
//
// Only env defaults live here — no config framework. Everything else is the
// official auto-instrumentation register, limited to four instrumentations:
// http (incoming spans), nestjs-core (Nest context), undici (native fetch
// outbound spans), pino (trace_id/span_id log correlation + OTLP log capture).
process.env.OTEL_SERVICE_NAME ??= 'tw-stock-dashboard-api';
process.env.OTEL_DEPLOYMENT_ENV ??= 'development';
process.env.OTEL_METRICS_EXPORTER ??= 'none';
process.env.OTEL_TRACES_EXPORTER ??= 'otlp';
process.env.OTEL_LOGS_EXPORTER ??= 'otlp';
process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS ??= 'http,nestjs-core,undici,pino';

// Map our deployment env onto the standard resource attribute name.
const resourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES ?? '';
if (!/(^|,)deployment\.environment\.name=/.test(resourceAttributes)) {
  const entry = `deployment.environment.name=${process.env.OTEL_DEPLOYMENT_ENV}`;
  process.env.OTEL_RESOURCE_ATTRIBUTES = resourceAttributes.length > 0 ? `${resourceAttributes},${entry}` : entry;
}

await import('@opentelemetry/auto-instrumentations-node/register');
