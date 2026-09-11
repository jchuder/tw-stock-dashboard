import { Effect, Either } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { CacheService } from './cache.service.js';
import { RedisCommandError } from './redis.error.js';
import type { RedisService } from './redis.service.js';

function stubRedis(overrides: Record<string, unknown> = {}): RedisService {
  return {
    ping: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    del: vi.fn(async () => 1),
    setNxPx: vi.fn(async () => true),
    releaseLockIfOwner: vi.fn(async () => 1),
    ...overrides,
  } as unknown as RedisService;
}

describe('CacheService mandatory-Redis behavior', () => {
  it('decodes cache hits and converts TTL seconds to milliseconds', async () => {
    const redis = stubRedis({ get: vi.fn(async () => '{"a":1}') });
    const service = new CacheService(redis);

    await expect(Effect.runPromise(service.getJson('k'))).resolves.toEqual({ a: 1 });
    await Effect.runPromise(service.setJson('k', { a: 1 }, 60));
    expect(redis.set).toHaveBeenCalledWith('k', '{"a":1}', 60_000);
  });

  it('resolves misses to null without failing', async () => {
    const service = new CacheService(stubRedis());

    await expect(Effect.runPromise(service.getJson('missing'))).resolves.toBeNull();
  });

  it('fails typed instead of bypassing when Redis commands fail', async () => {
    const failing = stubRedis({
      get: vi.fn(async () => Promise.reject(new RedisCommandError('GET', 'boom'))),
      set: vi.fn(async () => Promise.reject(new RedisCommandError('SET', 'boom'))),
      del: vi.fn(async () => Promise.reject(new RedisCommandError('DEL', 'boom'))),
    });
    const service = new CacheService(failing);

    const gotten = await Effect.runPromise(Effect.either(service.getJson('k')));
    expect(Either.isLeft(gotten)).toBe(true);
    const setted = await Effect.runPromise(Effect.either(service.setJson('k', { a: 1 }, 60)));
    expect(Either.isLeft(setted)).toBe(true);
    const deleted = await Effect.runPromise(Effect.either(service.del('k')));
    expect(Either.isLeft(deleted)).toBe(true);
    if (Either.isLeft(gotten)) {
      expect(gotten.left).toBeInstanceOf(RedisCommandError);
    }
  });

  it('evicts corrupt entries best-effort and resolves to a miss', async () => {
    const redis = stubRedis({ get: vi.fn(async () => '{not-json') });
    const service = new CacheService(redis);

    await expect(Effect.runPromise(service.getJson('k'))).resolves.toBeNull();
    expect(redis.del).toHaveBeenCalledWith('k');
  });
});
