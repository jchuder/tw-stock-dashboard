import { createClient, type RedisClientType } from 'redis';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';

// Test-only Redis isolation. Specs that boot the real CacheModule share one
// Redis with every other spec file in the worker pool; without isolation a
// snapshot cached by one file leaks into another file's call-count and
// freshness assertions. Only project-owned key namespaces are deleted —
// never FLUSHDB, so unrelated local data survives the test run.
const OWNED_PATTERNS = [
  'official-quote:*',
  'history:*',
  'security-universe*',
  'esb-latest:*',
  'mdw:v1:*',
];

const MUTEX_KEY = 'test:mutex:project-redis';
const MUTEX_PX_MS = 30_000;
const MUTEX_ACQUIRE_TIMEOUT_MS = 120_000;

const RELEASE_IF_OWNER_LUA = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

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

// Cross-file mutual exclusion for specs that touch the shared test Redis.
// Per-test flushing is not enough: a parallel file can write between another
// test's flush and its assertions. Hold the mutex for the whole test body.
// The PX expiry is a backstop so a crashed worker cannot wedge the suite.
export async function acquireProjectRedisMutex(): Promise<() => Promise<void>> {
  const client = connectTestClient();
  await client.connect();
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const start = Date.now();
  try {
    for (;;) {
      const acquired = await client.set(MUTEX_KEY, token, { NX: true, PX: MUTEX_PX_MS });
      if (acquired === 'OK') {
        break;
      }
      if (Date.now() - start > MUTEX_ACQUIRE_TIMEOUT_MS) {
        throw new Error('Timed out acquiring project Redis test mutex');
      }
      // Executor form: the repo targets ES2022, which has no Promise.withResolvers.
      await new Promise<void>((resolve) => setTimeout(resolve, 25 + Math.random() * 25));
    }
  } catch (cause) {
    await client.quit().catch(() => {});
    throw cause;
  }
  return async () => {
    try {
      await client.eval(RELEASE_IF_OWNER_LUA, { keys: [MUTEX_KEY], arguments: [token] });
    } finally {
      await client.quit().catch(() => {});
    }
  };
}

// Shared initialized CacheService for specs that exercise the real Redis
// JSON path. One instance per file is safe: it is stateless and every test
// flushes project keys under the mutex first.
export async function createTestCacheService(): Promise<CacheService> {
  const redis = new RedisService();
  await redis.onModuleInit();
  return new CacheService(redis);
}
