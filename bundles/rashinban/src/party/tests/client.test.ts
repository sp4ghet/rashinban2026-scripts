import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartyClient, PARTY_API, RejectedRequest } from '../../extension/party/client.ts';
import { createPartyManager } from '../../extension/party/manager.ts';
import type { PartyStatus } from '../types.ts';

const config = { cookie: 'SECRET', clientVersion: 'fixture', partyId: null };
test('client rejects untrusted endpoints before attaching credentials', async () => {
  let calls = 0;
  const client = createPartyClient(config, async () => { calls++; return Response.json({}); }, Date.now);
  for (const url of ['https://example.com/path', 'http://www.geoguessr.com/', 'https://www.geoguessr.com:444/', 'https://user@gs2.geoguessr.com/']) await assert.rejects(client.request(url), /Unsupported/);
  assert.equal(calls, 0);
});
test('client handles 204, refuses redirects, and separates definite rejection from uncertain server errors', async () => {
  let code = 204;
  const client = createPartyClient(config, async (_url, init) => {
    assert.equal(init?.redirect, 'manual');
    assert.equal((init?.headers as Record<string, string>).Cookie, '_ncfa=SECRET');
    return new Response(null, { status: code });
  }, Date.now);
  assert.equal(await client.request(PARTY_API + '/active'), null);
  for (code of [302, 401, 403, 400, 429]) await assert.rejects(client.request(PARTY_API + '/start-game', 'POST', {}), RejectedRequest);
  code = 500;
  await assert.rejects(client.request(PARTY_API + '/start-game', 'POST', {}), error => error instanceof Error && !(error instanceof RejectedRequest));
});
test('no active party is an empty lobby and does not attempt member/game reads', async () => {
  let status: PartyStatus | undefined; const urls: string[] = [];
  const manager = createPartyManager(config, {
    now: Date.now, selection: () => ({ input: 'live', partyId: null }), publish(value) { status = value; },
    fetch: async url => { urls.push(String(url)); return String(url).endsWith('/profiles/') ? Response.json({ user: { id: 'host' } }) : new Response(null, { status: 204 }); },
  });
  await manager.refresh(); assert.equal(status?.state, 'ready'); assert.equal(status?.party, null); assert.equal(status?.canManage, false);
  assert.equal(urls.length, 2); assert.equal(JSON.stringify(status).includes('SECRET'), false);
});
