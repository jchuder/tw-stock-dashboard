import { Schema } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import { SecuritySchema } from '@tw-stock-dashboard/contracts';
import { API_BASE_URL } from '../../../shared/api/base-url.js';

const SECURITY_LIST_SCHEMA = Schema.Array(SecuritySchema);
const MAX_SECURITY_BATCH = 100;

export class SecurityRequestError extends Error {
  constructor(readonly status: number) {
    super(`Security request failed: ${status}`);
  }
}

export async function fetchSecurities(symbols: readonly string[]): Promise<Security[]> {
  const chunks: string[][] = [];
  for (let index = 0; index < symbols.length; index += MAX_SECURITY_BATCH) {
    chunks.push([...symbols.slice(index, index + MAX_SECURITY_BATCH)]);
  }

  const responses = await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({ symbols: chunk.join(',') });
      const response = await fetch(`${API_BASE_URL}/api/v1/securities?${params.toString()}`);
      if (!response.ok) {
        throw new SecurityRequestError(response.status);
      }
      return Schema.decodeUnknownPromise(SECURITY_LIST_SCHEMA)((await response.json()) as unknown);
    }),
  );

  return responses.flat();
}
