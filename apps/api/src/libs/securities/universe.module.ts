import { Global, Module } from '@nestjs/common';
import { UniverseProvider } from './universe.provider.js';
import { UniverseResolver } from './universe.resolver.js';

// Global infrastructure: every feature injects the resolver with only a
// type-level feature->lib import, and no feature module ever imports another
// feature module. AppModule imports this once for registration.
@Global()
@Module({
  providers: [UniverseProvider, UniverseResolver],
  exports: [UniverseProvider, UniverseResolver],
})
export class UniverseModule {}
