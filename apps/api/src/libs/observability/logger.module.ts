import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import {
  LOG_LEVEL,
  REDACTED_PATHS,
  REQUEST_ID_HEADER,
  buildHttpCompletionLog,
  httpLogLevel,
  resolveRequestId,
} from './logger.config.js';

interface HttpLogSource {
  id?: unknown;
  method?: string;
  url?: string;
  route?: { path?: string };
  headers?: Record<string, unknown>;
}

interface HttpLogResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
}

function toCompletion(source: HttpLogSource, res: HttpLogResponse, durationMs: number) {
  return buildHttpCompletionLog({
    requestId: source.id,
    method: source.method ?? 'UNKNOWN',
    routePath: source.route?.path,
    url: source.url ?? '',
    statusCode: res.statusCode,
    durationMs,
  });
}

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: LOG_LEVEL,
        redact: REDACTED_PATHS,
        // Request-scoped child loggers carry only { request_id }: domain
        // logs written through PinoLogger join the request automatically.
        quietReqLogger: true,
        // The completion line goes through the *response* logger, so both
        // quiet flags are required to keep full req/res out of it.
        quietResLogger: true,
        customAttributeKeys: { reqId: 'request_id' },
        genReqId: (req, res) => {
          const id = resolveRequestId((req as HttpLogSource).headers?.['x-request-id']);
          (res as HttpLogResponse).setHeader(REQUEST_ID_HEADER, id);
          return id;
        },
        customSuccessObject: (req, res, val) =>
          toCompletion(req as HttpLogSource, res as HttpLogResponse, (val as { responseTime?: number }).responseTime ?? 0),
        customErrorObject: (req, res, _error, val) =>
          toCompletion(req as HttpLogSource, res as HttpLogResponse, (val as { responseTime?: number }).responseTime ?? 0),
        customLogLevel: (_req, res) => httpLogLevel((res as HttpLogResponse).statusCode),
      },
    }),
  ],
})
export class LoggerModule {}
