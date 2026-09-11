import { createConnection, type Socket } from 'node:net';

// Playwright global setup: flush project-owned Redis namespaces so e2e runs
// never inherit a poisoned window snapshot (e.g. a transient partial universe
// build cached as canonical). Only owned patterns are deleted.
//
// Zero-dependency minimal RESP client: e2e tooling must not gain production
// dependencies, and the CI runner has no redis-cli binary (Redis lives in a
// service container, reachable over TCP only).
const OWNED_PATTERNS = [
  'official-quote:*',
  'history:*',
  'security-universe*',
  'esb-latest:*',
  'mdw:v1:*',
];

type Reply = string | number | null | Reply[];

class RespConnection {
  private socket: Socket;
  private buffer = Buffer.alloc(0);
  private queue: Array<{
    resolve: (value: Reply) => void;
    reject: (cause: unknown) => void;
  }> = [];

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.pump();
    });
    socket.on('error', (cause) => {
      while (this.queue.length > 0) {
        this.queue.shift()?.reject(cause);
      }
    });
  }

  static connect(host: string, port: number): Promise<RespConnection> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port }, () => resolve(new RespConnection(socket)));
      socket.once('error', reject);
    });
  }

  close(): void {
    this.socket.destroy();
  }

  command(...args: (string | number)[]): Promise<Reply> {
    let out = `*${args.length}\r\n`;
    for (const arg of args) {
      const text = String(arg);
      out += `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.socket.write(out);
    });
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const parsed = this.parse(this.buffer, 0);
      if (parsed === null) {
        return;
      }
      this.buffer = this.buffer.subarray(parsed.next);
      this.queue.shift()?.resolve(parsed.value);
    }
  }

  private parse(buffer: Buffer, offset: number): { value: Reply; next: number } | null {
    if (offset >= buffer.length) {
      return null;
    }
    const marker = String.fromCharCode(buffer[offset]);
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd === -1) {
      return null;
    }
    const line = buffer.toString('utf8', offset + 1, lineEnd);
    const afterLine = lineEnd + 2;
    if (marker === '+' || marker === '-' || marker === ':') {
      const value = marker === ':' ? Number(line) : line;
      if (marker === '-') {
        throw new Error(`Redis error: ${line}`);
      }
      return { value, next: afterLine };
    }
    if (marker === '$') {
      const length = Number(line);
      if (length === -1) {
        return { value: null, next: afterLine };
      }
      if (buffer.length < afterLine + length + 2) {
        return null;
      }
      return { value: buffer.toString('utf8', afterLine, afterLine + length), next: afterLine + length + 2 };
    }
    if (marker === '*') {
      const count = Number(line);
      if (count === -1) {
        return { value: null, next: afterLine };
      }
      const items: Reply[] = [];
      let cursor = afterLine;
      for (let index = 0; index < count; index += 1) {
        const parsed = this.parse(buffer, cursor);
        if (parsed === null) {
          return null;
        }
        items.push(parsed.value);
        cursor = parsed.next;
      }
      return { value: items, next: cursor };
    }
    throw new Error(`Unexpected RESP marker: ${marker}`);
  }
}

function parseRedisUrl(url: string): { host: string; port: number } {
  const match = /^redis:\/\/([^/:]+)(?::(\d+))?/.exec(url);
  return { host: match?.[1] ?? 'localhost', port: Number(match?.[2] ?? 6379) };
}

async function setup(): Promise<void> {
  const { host, port } = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const redis = await RespConnection.connect(host, port);
  try {
    for (const pattern of OWNED_PATTERNS) {
      let cursor = '0';
      do {
        const reply = (await redis.command('SCAN', cursor, 'MATCH', pattern)) as [string, string[]];
        cursor = reply[0];
        if (reply[1].length > 0) {
          await redis.command('DEL', ...reply[1]);
        }
      } while (cursor !== '0');
    }
  } finally {
    redis.close();
  }
}

export default setup;
