export class RedisConfigError extends Error {
  readonly _tag = 'RedisConfigError';
  constructor(message = 'REDIS_URL is not set; Redis is a mandatory dependency') {
    super(message);
    this.name = 'RedisConfigError';
  }
}

export class RedisConnectionError extends Error {
  readonly _tag = 'RedisConnectionError';
  constructor(message: string) {
    super(message);
    this.name = 'RedisConnectionError';
  }
}

export class RedisCommandError extends Error {
  readonly _tag = 'RedisCommandError';
  constructor(
    readonly command: string,
    message: string,
  ) {
    super(message);
    this.name = 'RedisCommandError';
  }
}
