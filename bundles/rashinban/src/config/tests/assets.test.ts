import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { EventEmitter } from 'node:events';
import type NodeCG from '@nodecg/types';
import { listMediaAssets, resolveMediaFile, createMediaRouter, registerSharedAssets } from '../../extension/config/assets.ts';
import { mediaAssetOptions, mediaAssetsForCategory, mediaPlaybackUrl } from '../media-url.ts';

function fixture(t: { after(fn: () => void): void }) {
  const base = mkdtempSync(path.join(tmpdir(), 'rashinban-assets-'));
  const roots = { appRoot: path.join(base, 'preview'), sharedRoot: path.join(base, 'shared'), isWorktree: true };
  for (const root of [roots.appRoot, roots.sharedRoot]) for (const category of ['music', 'effects', 'video']) mkdirSync(path.join(root, 'assets/rashinban', category), {recursive: true});
  t.after(() => rmSync(base, {recursive:true, force:true}));
  const file = (scope: 'appRoot'|'sharedRoot', category: string, name: string, bytes: string) => {
    const result = path.join(roots[scope], 'assets/rashinban', category, name); writeFileSync(result, bytes); return result;
  };
  return { roots, file, base };
}

test('shared inventory merges by category and filename with local precedence and deletion fallback', t => {
  const {roots, file} = fixture(t);
  file('sharedRoot','music','A song.mp3','SHARED');
  file('sharedRoot','video','5K.webm','VIDEO');
  file('sharedRoot','music','ignore.txt','TEXT');
  const local = file('appRoot','music','A song.mp3','LOCAL');
  const list = listMediaAssets(roots);
  assert.deepEqual(list.music, [{base:'A song.mp3',url:'/assets/rashinban/music/A%20song.mp3',source:'local'}]);
  assert.equal(list.video[0].source,'shared');
  assert.equal(resolveMediaFile(roots,'music','A song.mp3'),local);
  rmSync(local);
  assert.equal(listMediaAssets(roots).music[0].source,'shared');
  assert.equal(resolveMediaFile(roots,'music','A song.mp3'),path.join(roots.sharedRoot,'assets/rashinban/music/A song.mp3'));
});

test('asset resolution rejects traversal, unsupported extensions, and escaped directory links', t => {
  const {roots, base} = fixture(t);
  const outside = path.join(base,'outside'); mkdirSync(outside); writeFileSync(path.join(outside,'secret.mp3'),'PRIVATE');
  rmSync(path.join(roots.appRoot,'assets/rashinban/music'),{recursive:true});
  symlinkSync(outside,path.join(roots.appRoot,'assets/rashinban/music'),'junction');
  for (const name of ['../outside/secret.mp3','..\\secret.mp3','secret.txt','\0.mp3']) assert.equal(resolveMediaFile(roots,'music',name),null);
  assert.equal(resolveMediaFile(roots,'unknown','secret.mp3'),null);
  assert.equal(resolveMediaFile(roots,'music','secret.mp3'),null);
  assert.deepEqual(listMediaAssets(roots).music,[]);
});

test('presenter delivery serves local then shared bytes and supports video range requests', async t => {
  const {roots,file} = fixture(t);
  file('sharedRoot','video','clip.webm','SHARED VIDEO');
  const local=file('appRoot','video','clip.webm','LOCAL VIDEO');
  const app=express(); app.use('/assets',(_req,res)=>{res.sendStatus(404);}); app.use('/rashinban/media',createMediaRouter(roots));
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address(); assert.ok(address && typeof address==='object');
  const base=`http://127.0.0.1:${address.port}/rashinban/media/video/clip.webm`;
  const range=await fetch(base,{headers:{range:'bytes=0-4'}});
  assert.equal(range.status,206); assert.equal(await range.text(),'LOCAL'); assert.equal(range.headers.get('content-range'),'bytes 0-4/11');
  rmSync(local);
  assert.equal(await (await fetch(base)).text(),'SHARED VIDEO');
  const head=await fetch(base,{method:'HEAD'}); assert.equal(head.status,200); assert.equal(head.headers.get('content-length'),'12');
  assert.equal((await fetch(base.replace('clip.webm','%2Foutside.webm'))).status,404);
});

test('stored canonical asset references map to delivery URLs without changing manifest identity', () => {
  assert.equal(mediaPlaybackUrl('/assets/rashinban/effects/a%20cue.wav'),'/rashinban/media/effects/a%20cue.wav');
  assert.equal(mediaPlaybackUrl('/already-owned/url.mp3'),'/already-owned/url.mp3');
  assert.throws(()=>mediaPlaybackUrl('/assets/rashinban/music/..%2Fsecret.mp3'));
  assert.throws(()=>mediaPlaybackUrl('/assets/rashinban/other/file.mp3'));
});

test('merged inventory remains authoritative and selector refreshes preserve dirty choices', () => {
  const inherited = { base: 'shared cue.wav', url: '/assets/rashinban/effects/shared%20cue.wav', source: 'shared' as const };
  const merged = { music: [], effects: [inherited], video: [] };
  const native = [{ base: 'local-only.wav', url: '/assets/rashinban/effects/local-only.wav' }];
  assert.deepEqual(mediaAssetsForCategory(merged, 'effects', native), [inherited]);
  assert.deepEqual(mediaAssetsForCategory(undefined, 'effects', native), native);
  assert.deepEqual(mediaAssetsForCategory({ ...merged, effects: [] }, 'effects', native), []);
  assert.deepEqual(mediaAssetOptions([inherited], '/assets/rashinban/effects/dirty.wav'), [
    { label: 'None', value: '' },
    { label: 'shared cue.wav (inherited)', value: inherited.url },
    { label: 'Unavailable · dirty.wav', value: '/assets/rashinban/effects/dirty.wav' },
  ]);
});

test('shared asset registration protects delivery and refreshes inventory after local upload/deletion', async t => {
  const { roots, file } = fixture(t);
  file('sharedRoot', 'music', 'track.mp3', 'SHARED');
  const events = new EventEmitter();
  const app = express();
  let authorizationChecks = 0;
  const rep = { value: { music: [], effects: [], video: [] } as ReturnType<typeof listMediaAssets> };
  const nodecg = Object.assign(events, {
    Replicant(name: string, options: { persistent: boolean }) {
      assert.equal(name, 'presenterAssets'); assert.equal(options.persistent, false); return rep;
    },
    util: { authCheck: ((_req, res) => { authorizationChecks++; res.sendStatus(401); }) as express.RequestHandler },
    mount: app.use.bind(app),
  });
  registerSharedAssets(nodecg as unknown as NodeCG.ServerAPI, roots);
  t.after(() => events.emit('serverStopping'));
  assert.equal(rep.value.music[0].source, 'shared');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/rashinban/media/music/track.mp3`)).status, 401);
  assert.equal(authorizationChecks, 1);
  async function waitForSource(source: string) {
    const deadline = Date.now() + 3500;
    while (rep.value.music[0]?.source !== source && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(rep.value.music[0]?.source, source);
  }
  const inherited = rep.value;
  const local = file('appRoot', 'music', 'track.mp3', 'LOCAL');
  await waitForSource('local');
  assert.equal(inherited.music[0].source, 'shared');
  rmSync(local);
  await waitForSource('shared');
});
