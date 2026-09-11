import { createClient, type RedisClientType } from 'redis';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';

// Test-only Redis isolation. The API suite runs with fileParallelism: false,
// so spec files never execute concurrently; per-test flushing of
// project-owned key namespaces is sufficient isolation. Only those namespaces
// are deleted — never FLUSHDB, so unrelated local data survives the test run.
const OWNED_PATTERNS = [
  'official-quote:*',
  'history:*',
  'security-universe*',
  'esb-latest:*',
  'mdw:v1:*',
];

function connectTestClient(): RedisClientType {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
  });
}

export async function flushProjectRedisKeys(): Promise<void> {
  const client = connectTestClient();
  await client.connect();
  try {
    for (const pattern of OWNED_PATTERNS) {
      // node-redis v6 scanIterator yields key batches (including empty ones).
      for await (const batch of client.scanIterator({ MATCH: pattern })) {
        if (batch.length > 0) {
          await client.del(batch);
        }
      }
    }
  } finally {
    await client.quit().catch(() => {});
  }
}


// Shared initialized CacheService for specs that exercise the real Redis
// JSON path. One instance per file is safe: it is stateless and every test
// flushes project keys under the mutex first.
export async function createTestCacheService(): Promise<CacheService> {
  const redis = new RedisService();
  await redis.onModuleInit();
  return new CacheService(redis);
}
