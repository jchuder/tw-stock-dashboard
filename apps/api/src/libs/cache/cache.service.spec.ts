import { Effect } from 'effect';
import type { RedisClientType } from 'redis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from './cache.service.js';
import { getRedisClient } from './redis.client.js';

vi.mock('./redis.client.js', () => ({
  getRedisClient: vi.fn(),
  reportRedisFailure: vi.fn(),
}));
function fakeClient(overrides: Record<string, unknown> = {}): RedisClientType {
  return {
    isOpen: true,
    connect: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
    ...overrides,
  } as unknown as RedisClientType;
}

async function freshService(): Promise<CacheService> {
  // Exception: dynamic import exercises the module-registry boundary — each
  // test needs a fresh connectAttempt state after vi.resetModules().
  vi.resetModules();
  const { CacheService: Fresh } = await import('./cache.service.js');
  return new Fresh();
}

describe('CacheService fail-open behavior', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.mocked(getRedisClient).mockReset();
  });

  it('exposes fail-fast client options', async () => {
    const actual = await vi.importActual<typeof import('./redis.client.js')>('./redis.client.js');

    expect(actual.buildClientOptions('redis://redis:6379')).toEqual({
      url: 'redis://redis:6379',
      disableOfflineQueue: true,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
  });

  it('bypasses everything when Redis is disabled', async () => {
    vi.mocked(getRedisClient).mockReturnValue(null);
    const service = await freshService();

    await expect(Effect.runPromise(service.getJson('k'))).resolves.toBeNull();
    await expect(Effect.runPromise(service.setJson('k', { a: 1 }, 60))).resolves.toBeUndefined();
    await expect(Effect.runPromise(service.del('k'))).resolves.toBeUndefined();
  });

  it('returns null and void immediately when connect fails', async () => {
    vi.mocked(getRedisClient).mockReturnValue(
      fakeClient({ isOpen: false, connect: vi.fn(async () => Promise.reject(new Error('down'))) }),
    );
    const service = await freshService();

    await expect(Effect.runPromise(service.getJson('k'))).resolves.toBeNull();
    await expect(Effect.runPromise(service.setJson('k', { a: 1 }, 60))).resolves.toBeUndefined();
  });

  it('returns null when GET rejects', async () => {
    vi.mocked(getRedisClient).mockReturnValue(
      fakeClient({ get: vi.fn(async () => Promise.reject(new Error('boom'))) }),
    );
    const service = await freshService();

    await expect(Effect.runPromise(service.getJson('k'))).resolves.toBeNull();
  });

  it('deletes corrupt entries instead of serving them forever', async () => {
    const client = fakeClient({ get: vi.fn(async () => '{not-json') });
    vi.mocked(getRedisClient).mockReturnValue(client);
    const service = await freshService();

    await expect(Effect.runPromise(service.getJson('k'))).resolves.toBeNull();
    expect(client.del).toHaveBeenCalledWith('k');
  });

  it('parses valid entries', async () => {
    vi.mocked(getRedisClient).mockReturnValue(fakeClient({ get: vi.fn(async () => '{"a":1}') }));
    const service = await freshService();

    await expect(Effect.runPromise(service.getJson('k'))).resolves.toEqual({ a: 1 });
  });

  it('resolves void when SET or DEL reject', async () => {
    vi.mocked(getRedisClient).mockReturnValue(
      fakeClient({
        set: vi.fn(async () => Promise.reject(new Error('boom'))),
        del: vi.fn(async () => Promise.reject(new Error('boom'))),
      }),
    );
    const service = await freshService();

    await expect(Effect.runPromise(service.setJson('k', { a: 1 }, 60))).resolves.toBeUndefined();
    await expect(Effect.runPromise(service.del('k'))).resolves.toBeUndefined();
  });
});
