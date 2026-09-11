import { Injectable, Logger } from '@nestjs/common';
import { Effect } from 'effect';
import type { RedisCommandError, RedisConnectionError } from './redis.error.js';
import { RedisService } from './redis.service.js';

export type CacheInfrastructureError = RedisCommandError | RedisConnectionError;

// Structural port for JSON cache consumers: providers depend only on the
// three methods they use (same philosophy as the UniverseCache port), which
// also keeps Pick-based test fakes assignable now that the class carries
// private infrastructure state.
export type CachePort = Pick<CacheService, 'getJson' | 'setJson' | 'del' | 'setNxPx' | 'releaseLockIfOwner'>;

const log = new Logger('CacheService');

// Mandatory-Redis JSON cache adapter (ADR 008). Reads resolve to data or
// null (miss); infrastructure failures are typed, never swallowed, so callers
// map them to domain errors instead of silently bypassing to upstream.
// Corrupt payloads are evicted best-effort and resolve to a miss — the
// rebuild overwrites the poisoned entry.
@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisService) {}

  getJson(key: string): Effect.Effect<unknown | null, CacheInfrastructureError> {
    return Effect.gen(this, function* () {
      const raw = yield* Effect.tryPromise({
        try: () => this.redis.get(key),
        catch: (cause) => cause as CacheInfrastructureError,
      });
      if (raw === null) {
        return null;
      }
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        log.warn(`Redis cache decode failed for key ${key}; evicting entry as a miss`);
        yield* Effect.ignore(
          Effect.tryPromise({
            try: () => this.redis.del(key),
            catch: () => undefined,
          }),
        );
        return null;
      }
    });
  }

  setJson(key: string, value: unknown, ttlSeconds: number): Effect.Effect<void, CacheInfrastructureError> {
    return Effect.tryPromise({
      try: () => this.redis.set(key, JSON.stringify(value), ttlSeconds * 1000),
      catch: (cause) => cause as CacheInfrastructureError,
    });
  }

  setNxPx(key: string, token: string, ttlMs: number): Effect.Effect<boolean, CacheInfrastructureError> {
    return Effect.tryPromise({
      try: () => this.redis.setNxPx(key, token, ttlMs),
      catch: (cause) => cause as CacheInfrastructureError,
    });
  }

  releaseLockIfOwner(key: string, token: string): Effect.Effect<number, CacheInfrastructureError> {
    return Effect.tryPromise({
      try: () => this.redis.releaseLockIfOwner(key, token),
      catch: (cause) => cause as CacheInfrastructureError,
    });
  }

  del(key: string): Effect.Effect<void, CacheInfrastructureError> {
    return Effect.tryPromise({
      try: () =>
        this.redis.del(key).then(() => undefined),
      catch: (cause) => cause as CacheInfrastructureError,
    });
  }
}
