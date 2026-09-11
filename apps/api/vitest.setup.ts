// ADR 008: Redis is a mandatory test dependency. Default to local Redis so
// `pnpm test` works without extra env; CI provides the service explicitly.
// Specs that assert missing-URL behavior manage process.env themselves.
process.env.REDIS_URL ??= 'redis://localhost:6379';
