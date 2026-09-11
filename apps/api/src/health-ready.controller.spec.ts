import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HealthReadyController } from './app.module.js';
import type { RedisService } from './libs/cache/redis.service.js';

function controller(ping: () => Promise<void>): HealthReadyController {
  return new HealthReadyController({ ping } as unknown as RedisService);
}

describe('HealthReadyController', () => {
  it('returns ok when Redis pings', async () => {
    await expect(controller(async () => {}).getReady()).resolves.toEqual({ status: 'ok' });
  });

  it('throws 503 when Redis is unavailable', async () => {
    const error = await controller(async () => {
      throw new Error('down');
    })
      .getReady()
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  });
});
