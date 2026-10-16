import type { ConnectionConfig } from '../presenter/connection.ts';

export const PARTY_API = 'https://www.geoguessr.com/api/v4/parties/v2';
export class RejectedRequest extends Error {}
export function createPartyClient(config: ConnectionConfig, fetcher: typeof fetch, now: () => number) {
  let serverOffsetMs = 0;
  return {
    get serverOffsetMs() { return serverOffsetMs; },
    async request(url: string, method = 'GET', body?: unknown): Promise<unknown> {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['www.geoguessr.com', 'gs2.geoguessr.com'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw new Error('Unsupported GeoGuessr endpoint');
      const start = now();
      const response = await fetcher(url, {
        method, redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { Cookie: `_ncfa=${config.cookie}`, 'X-Client': `web-${config.clientVersion}`, 'X-Locale': 'en', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401 || response.status === 403) throw new RejectedRequest('GeoGuessr rejected authentication or host permissions. Check the configured account.');
      if (response.status >= 300 && response.status < 400 || response.redirected) throw new RejectedRequest('GeoGuessr redirected the request. Reconnect before continuing.');
      if (!response.ok) {
        const message = `GeoGuessr returned HTTP ${response.status}. Refresh state before continuing.`;
        // A server failure may occur after a mutation was applied.
        if (response.status >= 500) throw new Error(message);
        throw new RejectedRequest(message);
      }
      const header = response.headers.get('X-ServerTime');
      if (header) {
        const numeric = Number(header); const server = Number.isFinite(numeric) ? numeric < 1e10 ? numeric * 1000 : numeric : Date.parse(header);
        if (Number.isFinite(server)) serverOffsetMs = server - (start + now()) / 2;
      }
      if (response.status === 204 || method !== 'GET') return null;
      return response.json();
    },
  };
}
