import { afterEach, describe, expect, it } from 'vitest';
import { RedisConfigError, RedisConnectionError } from './redis.error.js';
import { RedisService } from './redis.service.js';

const REAL_URL = 'redis://localhost:6379';

describe('RedisService mandatory lifecycle', () => {
  const saved = process.env.REDIS_URL;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = saved;
    }
  });

  it('fails startup when REDIS_URL is missing', async () => {
    delete process.env.REDIS_URL;
    const service = new RedisService();

    await expect(service.onModuleInit()).rejects.toBeInstanceOf(RedisConfigError);
  });

  it('fails startup when REDIS_URL is blank', async () => {
    process.env.REDIS_URL = '   ';
    const service = new RedisService();

    await expect(service.onModuleInit()).rejects.toBeInstanceOf(RedisConfigError);
  });

  it('fails startup when Redis is unreachable', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:9';
    const service = new RedisService();

    await expect(service.onModuleInit()).rejects.toBeInstanceOf(RedisConnectionError);
  });

  it('connects and pings when Redis is available', async () => {
    process.env.REDIS_URL = REAL_URL;
    const service = new RedisService();

    await service.onModuleInit();
    await expect(service.ping()).resolves.toBeUndefined();
    await service.onModuleDestroy();
  });

  it('acquires a lock only once and releases only for the owner token', async () => {
    process.env.REDIS_URL = REAL_URL;
    const service = new RedisService();
    await service.onModuleInit();
    try {
      const key = `spec:lock:${Date.now()}`;
      await expect(service.setNxPx(key, 'token-a', 10_000)).resolves.toBe(true);
      await expect(service.setNxPx(key, 'token-b', 10_000)).resolves.toBe(false);
      await expect(service.releaseLockIfOwner(key, 'token-b')).resolves.toBe(0);
      await expect(service.get(key)).resolves.toBe('token-a');
      await expect(service.releaseLockIfOwner(key, 'token-a')).resolves.toBe(1);
      await expect(service.get(key)).resolves.toBeNull();
    } finally {
      await service.onModuleDestroy();
    }
  });

  it('round-trips get/set/del', async () => {
    process.env.REDIS_URL = REAL_URL;
    const service = new RedisService();
    await service.onModuleInit();
    try {
      const key = `spec:kv:${Date.now()}`;
      await service.set(key, 'v1', 60_000);
      await expect(service.get(key)).resolves.toBe('v1');
      await service.del(key);
      await expect(service.get(key)).resolves.toBeNull();
    } finally {
      await service.onModuleDestroy();
    }
  });
});
