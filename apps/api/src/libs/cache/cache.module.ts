import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';
import { WindowCacheService } from './window-cache.service.js';

// Boundary-driven token: libs/securities and libs/cache are sibling lib
// elements, so neither may file-import the other. Features inject this string
// token (provided here, bound to the shared CacheService) instead of the
// class. The literal is duplicated in libs/securities/universe-cache.port.ts
// by convention — keep both spellings in sync.
export const UNIVERSE_CACHE_TOKEN = 'universe-cache';

@Global()
@Module({
  providers: [RedisService, CacheService, WindowCacheService, { provide: UNIVERSE_CACHE_TOKEN, useExisting: CacheService }],
  exports: [RedisService, CacheService, WindowCacheService, UNIVERSE_CACHE_TOKEN],
})
export class CacheModule {}
