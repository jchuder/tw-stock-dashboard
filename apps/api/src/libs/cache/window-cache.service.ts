import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock, Duration, Effect } from 'effect';
import { CacheService, type CacheInfrastructureError, type CachePort } from './cache.service.js';
import { WindowCoordinationTimeoutError } from './window-cache.error.js';

export interface WindowCachePolicy {
  /** Freshness window length. Snapshots are shared per windowId. */
  readonly windowMs: number;
  /** Redis retention for the snapshot envelope (garbage collection only). */
  readonly snapshotTtlMs: number;
  /** Distributed lock TTL: covers one refresh operation, never the window. */
  readonly lockTtlMs: number;
  /** Base follower poll interval between snapshot re-reads. */
  readonly followerPollMs: number;
  /** Random jitter added to each follower poll. */
  readonly followerJitterMs: number;
  /** Follower deadline before failing closed. */
  readonly followerMaxWaitMs: number;
}

export interface WindowCacheResult<T> {
  readonly value: T;
  readonly windowId: number;
  readonly cacheHit: boolean;
}

interface WindowEnvelope {
  readonly version: 1;
  readonly windowId: number;
  readonly storedAt: string;
  readonly value: unknown;
}

function parseEnvelope(raw: unknown): WindowEnvelope | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  if (entry.version !== 1 || typeof entry.windowId !== 'number' || typeof entry.storedAt !== 'string') {
    return null;
  }
  if (!('value' in entry)) {
    return null;
  }
  return { version: 1, windowId: entry.windowId, storedAt: entry.storedAt, value: entry.value };
}

function windowIdOf(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs);
}

// The single coordination primitive for every market-data upstream (ADR 008).
// At most one refresh per resource per freshness window, no matter how many
// tabs or API instances request it: the first requester becomes the leader via
// a stable per-resource lock, followers wait for the snapshot, and stragglers
// past the deadline fail closed instead of bypassing to upstream.
@Injectable()
export class WindowCacheService {
  constructor(@Inject(CacheService) private readonly cache: CachePort) {}

  getOrLoad<T, E>(options: {
    readonly key: string;
    readonly policy: WindowCachePolicy;
    readonly decode: (value: unknown) => T | null;
    readonly load: () => Effect.Effect<T, E>;
  }): Effect.Effect<WindowCacheResult<T>, E | CacheInfrastructureError | WindowCoordinationTimeoutError> {
    const { key, policy, decode, load } = options;
    const lockKey = `${key}:lock`;
    return Effect.gen(this, function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const currentWindow = windowIdOf(nowMs, policy.windowMs);
      const fresh = yield* this.readFresh(key, decode, currentWindow);
      if (fresh !== null) {
        return { value: fresh, windowId: currentWindow, cacheHit: true };
      }
      const token = randomUUID();
      const acquired = yield* this.cache.setNxPx(lockKey, token, policy.lockTtlMs);
      if (acquired) {
        return yield* this.lead(key, lockKey, token, policy, decode, load);
      }
      return yield* this.follow(key, lockKey, token, policy, decode, load, nowMs);
    });
  }

  private readFresh<T>(
    key: string,
    decode: (value: unknown) => T | null,
    windowId: number,
  ): Effect.Effect<T | null, CacheInfrastructureError> {
    return Effect.gen(this, function* () {
      const envelope = parseEnvelope(yield* this.cache.getJson(key));
      if (envelope === null || envelope.windowId !== windowId) {
        return null;
      }
      // A undecodable value is corruption, not data: evict best-effort so the
      // rebuild below overwrites it, then resolve as a miss.
      const value = decode(envelope.value);
      if (value === null) {
        yield* Effect.ignore(this.cache.del(key));
        return null;
      }
      return value;
    });
  }

  private lead<T, E>(
    key: string,
    lockKey: string,
    token: string,
    policy: WindowCachePolicy,
    decode: (value: unknown) => T | null,
    load: () => Effect.Effect<T, E>,
  ): Effect.Effect<WindowCacheResult<T>, E | CacheInfrastructureError> {
    // NOTE: release lives in Effect.ensuring, not try/finally: Effect.gen
    // abandons the generator on failure instead of resuming it, so a
    // finally block would be skipped exactly when the lock most needs
    // releasing (loader failure).
    const doLoad = Effect.gen(this, function* () {
      // Double-check after acquiring: a concurrent refresh may have filled
      // the window while this request was racing for the lock.
      // Recompute the double-check window from Clock: if we crossed a boundary
      // while acquiring the lock, check the current window, not a stale one.
      const doubleCheckMs = yield* Clock.currentTimeMillis;
      const doubleCheckWindow = windowIdOf(doubleCheckMs, policy.windowMs);
      const raced = yield* this.readFresh(key, decode, doubleCheckWindow);
      if (raced !== null) {
        return { value: raced, windowId: doubleCheckWindow, cacheHit: true };
      }
      const value = yield* load();
      // The completion instant decides the window, so a refresh that spans
      // a boundary is usable by followers arriving in the new window.
      const completedMs = yield* Clock.currentTimeMillis;
      const storedWindow = windowIdOf(completedMs, policy.windowMs);
      const envelope: WindowEnvelope = {
        version: 1,
        windowId: storedWindow,
        storedAt: new Date(completedMs).toISOString(),
        value,
      };
      yield* this.cache.setJson(key, envelope, Math.ceil(policy.snapshotTtlMs / 1000));
      return { value, windowId: storedWindow, cacheHit: false };
    });
    // Best-effort unlock: the lock PX is the backstop, and failing the
    // served refresh over unlock would punish the request for nothing.
    return Effect.ensuring(doLoad, Effect.ignore(this.cache.releaseLockIfOwner(lockKey, token)));
  }

  private follow<T, E>(
    key: string,
    lockKey: string,
    token: string,
    policy: WindowCachePolicy,
    decode: (value: unknown) => T | null,
    load: () => Effect.Effect<T, E>,
    startMs: number,
  ): Effect.Effect<WindowCacheResult<T>, E | CacheInfrastructureError | WindowCoordinationTimeoutError> {
    return Effect.gen(this, function* () {
      for (;;) {
        const nowMs = yield* Clock.currentTimeMillis;
        const currentWindow = windowIdOf(nowMs, policy.windowMs);
        // The leader may have finished between our miss and its lock win, or during our sleep.
        const raced = yield* this.readFresh(key, decode, currentWindow);
        if (raced !== null) {
          return { value: raced, windowId: currentWindow, cacheHit: true };
        }
        if (nowMs - startMs >= policy.followerMaxWaitMs) {
          return yield* Effect.fail(new WindowCoordinationTimeoutError(key, nowMs - startMs));
        }
        // Compete unconditionally: a held lock makes SET NX fail cheaply, a
        // gone lock lets this follower take over. Lock tokens are plain
        // strings, so they must never be read through the JSON path (a
        // non-JSON read would misclassify the lock as corruption and delete
        // the leader's lock).
        const acquired = yield* this.cache.setNxPx(lockKey, token, policy.lockTtlMs);
        if (acquired) {
          return yield* this.lead(key, lockKey, token, policy, decode, load);
        }
        yield* Effect.sleep(Duration.millis(policy.followerPollMs + Math.random() * policy.followerJitterMs));
      }
    });
  }
}
