import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { getRedisClient, reportRedisFailure } from './redis.client.js';

// node-redis connects lazily; ensureConnected issues one shared connect attempt
// so concurrent first requests do not stampede it.
let connectAttempt: Promise<unknown> | null = null;

async function ensureConnected(): Promise<boolean> {
  const client = getRedisClient();
  if (!client) {
    return false;
  }
  if (client.isOpen) {
    return true;
  }
  try {
    connectAttempt ??= client.connect().catch((err: unknown) => {
      connectAttempt = null;
      throw err;
    });
    await connectAttempt;
    return true;
  } catch (err) {
    reportRedisFailure(`Redis connect failed, bypassing cache: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// Fail-open JSON cache adapter. Every failure path resolves to the bypass
// value (null / void) instead of failing the Effect: cache infrastructure
// must degrade performance, never correctness. Corrupt entries are deleted
// so one bad write cannot poison reads for a full TTL.
@Injectable()
export class CacheService {
  getJson(key: string): Effect.Effect<unknown | null, never> {
    return Effect.promise(async () => {
      try {
        if (!(await ensureConnected())) {
          return null;
        }
        const raw = await getRedisClient()?.get(key);
        if (raw === undefined || raw === null) {
          return null;
        }
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          reportRedisFailure(`Redis cache decode failed for key ${key}, deleting entry`);
          await getRedisClient()?.del(key);
          return null;
        }
      } catch (err) {
        reportRedisFailure(
          `Redis GET failed for key ${key}, bypassing cache: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    });
  }

  setJson(key: string, value: unknown, ttlSeconds: number): Effect.Effect<void, never> {
    return Effect.promise(async () => {
      try {
        if (!(await ensureConnected())) {
          return;
        }
        await getRedisClient()?.set(key, JSON.stringify(value), { EX: ttlSeconds });
      } catch (err) {
        reportRedisFailure(
          `Redis SET failed for key ${key}, bypassing cache: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }
}
