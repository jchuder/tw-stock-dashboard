import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { RedisCommandError, RedisConfigError, RedisConnectionError } from './redis.error.js';

// Compare-and-delete release: a leader whose lock already expired must never
// delete the successor's lock with a plain DEL.
const RELEASE_IF_OWNER_LUA = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

// Mandatory Redis access owned by the Nest lifecycle. Missing REDIS_URL or a
// failed startup connect/PING throws from onModuleInit so the process never
// finishes listening without its coordination backend. Commands fail fast
// (no offline queue, no background reconnect); the next access retries the
// connection, so recovery needs no restart.
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      throw new RedisConfigError();
    }
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    client.on('error', () => {});
    try {
      await client.connect();
      await client.ping();
    } catch {
      throw new RedisConnectionError('Redis is unreachable; refusing to start without coordination backend');
    }
    this.client = client;
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.quit().catch(() => {});
    }
  }

  async ping(): Promise<void> {
    const client = await this.connected();
    try {
      await client.ping();
    } catch (cause) {
      throw new RedisConnectionError(`Redis PING failed: ${messageOf(cause)}`);
    }
  }

  async get(key: string): Promise<string | null> {
    const client = await this.connected();
    try {
      return await client.get(key);
    } catch (cause) {
      throw new RedisCommandError('GET', messageOf(cause));
    }
  }

  async set(key: string, value: string, pxMs: number): Promise<void> {
    const client = await this.connected();
    try {
      await client.set(key, value, { PX: pxMs });
    } catch (cause) {
      throw new RedisCommandError('SET', messageOf(cause));
    }
  }

  async del(key: string): Promise<number> {
    const client = await this.connected();
    try {
      return await client.del(key);
    } catch (cause) {
      throw new RedisCommandError('DEL', messageOf(cause));
    }
  }

  async setNxPx(key: string, token: string, pxMs: number): Promise<boolean> {
    const client = await this.connected();
    try {
      return (await client.set(key, token, { NX: true, PX: pxMs })) === 'OK';
    } catch (cause) {
      throw new RedisCommandError('SET NX PX', messageOf(cause));
    }
  }

  async releaseLockIfOwner(key: string, token: string): Promise<number> {
    const client = await this.connected();
    try {
      const released = (await client.eval(RELEASE_IF_OWNER_LUA, {
        keys: [key],
        arguments: [token],
      })) as number;
      return released === 1 ? 1 : 0;
    } catch (cause) {
      throw new RedisCommandError('EVAL release-lock', messageOf(cause));
    }
  }

  private async connected(): Promise<RedisClientType> {
    if (this.client?.isOpen === true) {
      return this.client;
    }
    // Reuse the startup-established client when possible; otherwise fail fast.
    // A dropped connection is retried here (bounded by connectTimeout), so a
    // recovered Redis resumes serving without a process restart.
    const client = this.client;
    if (!client) {
      throw new RedisConnectionError('Redis client is not initialized');
    }
    try {
      await client.connect();
      return client;
    } catch {
      throw new RedisConnectionError('Redis is unreachable');
    }
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
