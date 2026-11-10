// Goal: editing roles from a hosting service are parsed strictly, cached briefly, and enforced
// by the editing server however the browser behaves.
// Method: check the role rules directly, drive the hosting lookup with a fake service, and send
// actions and text updates to a real collaboration room as Content, Layout and Full editors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { WebSocket, WebSocketServer } from 'ws';
import { allowsRequest, editorRoleFor, parseAccessRole, type AccessRole } from '../src/features/roles/accessRole';
import { createHostingRoles, readRoleResponse } from '../src/features/auth/hostingAccess';
import { createAccessCheck, type AccessConfig } from '../src/features/auth/repositoryAccess';
import { Room, checksum } from '../src/features/collaboration/rooms';
import { flatten, nodesOf } from '../src/features/source/source';
import { record } from '../src/shared/validation';

const hosting = { HOSTING_ROLE_URL: 'https://hosting.example.com/api/studio/role', HOSTING_KEY: 'k'.repeat(40) };

test('roles parse strictly and map onto the editing modes', () => {
  assert.equal(parseAccessRole('layout'), 'layout');
  assert.equal(parseAccessRole('owner'), undefined);
  assert.equal(parseAccessRole(undefined), undefined);
  assert.deepEqual((['content', 'layout', 'design', 'full'] as const).map(editorRoleFor), ['client', 'client', 'designer', 'designer']);
});

test('each role may only make the writes it covers; reads are always allowed', () => {
  const can = (role: AccessRole, pathname: string, method = 'POST') => allowsRequest(role, method, pathname);
  for (const role of ['content', 'layout', 'design', 'full'] as const) {
    assert.ok(can(role, '/studio/api/source', 'GET'), `${role} reads`);
    assert.ok(can(role, '/studio/api/upload'), `${role} uploads images`);
    assert.ok(can(role, '/studio/api/cms'), `${role} edits CMS entries`);
    assert.ok(can(role, '/studio/api/publish'), `${role} publishes`);
  }
  for (const role of ['content', 'layout'] as const) {
    for (const pathname of [
      '/studio/api/source',
      '/studio/api/variables',
      '/studio/api/component-properties',
      '/studio/api/create',
      '/studio/api/pages/rename',
    ]) {
      assert.equal(can(role, pathname), false, `${role} may not write ${pathname}`);
    }
  }
  assert.ok(can('design', '/studio/api/source'), 'design saves styles');
  assert.ok(can('design', '/studio/api/variables'));
  for (const pathname of ['/studio/api/ai/propose', '/studio/api/git/incoming', '/studio/api/publish/account', '/studio/api/import-source']) {
    assert.equal(can('design', pathname), false, `design may not write ${pathname}`);
    assert.ok(can('full', pathname), `full may write ${pathname}`);
  }
  assert.equal(can('layout', '/studio/api/sourcex'), true, 'rules match whole paths, not prefixes');
});

test('the hosting lookup needs its settings, caches briefly, and rechecks when asked', async () => {
  let clock = 0;
  const answers: (AccessRole | null)[] = ['layout', 'design', null, 'full'];
  const calls: number[] = [];
  const roles = createHostingRoles(
    async (_url, _key, id) => {
      calls.push(id);
      return answers.shift() ?? null;
    },
    () => clock,
  );
  await assert.rejects(roles({ id: 7 }, {}), /HOSTING_ROLE_URL/);
  await assert.rejects(roles({ id: 7 }, { ...hosting, HOSTING_ROLE_URL: 'http://hosting.example.com/role' }), /https/);
  await assert.rejects(roles({ id: 7 }, { ...hosting, HOSTING_KEY: 'short' }), /HOSTING_KEY/);
  assert.equal(await roles({ id: 7 }, hosting), 'layout');
  assert.equal(await roles({ id: 7 }, hosting), 'layout', 'cached');
  assert.equal(await roles({ id: 7 }, hosting, true), 'design', 'fresh lookups skip the cache');
  clock += 61_000;
  assert.equal(await roles({ id: 7 }, hosting), null, 'grants expire within a minute');
  clock += 10_000;
  assert.equal(await roles({ id: 7 }, hosting), null, 'denials are cached briefly');
  clock += 6_000;
  assert.equal(await roles({ id: 7 }, hosting), 'full');
  assert.deepEqual(calls, [7, 7, 7, 7]);
});

test("the hosting service's answer is read strictly; anything odd is never a grant", async () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  assert.equal(await readRoleResponse(json({ github_id: 7, role: 'content' }), 7), 'content');
  assert.equal(await readRoleResponse(json({ role: null }, 404), 7), null);
  await assert.rejects(readRoleResponse(json({ github_id: 8, role: 'full' }), 7), /unexpected role/);
  await assert.rejects(readRoleResponse(json({ github_id: 7, role: 'owner' }), 7), /unexpected role/);
  await assert.rejects(readRoleResponse(json({ error: 'down' }, 500), 7), /Could not check/);
  await assert.rejects(readRoleResponse(json({ error: 'bad key' }, 401), 7), /Could not check/);
});

test('hosting access grants editing to anyone with a role, without repository access', async () => {
  const config: AccessConfig = {
    ...hosting,
    EDITOR_ACCESS: 'hosting',
    EDITOR_GITHUB_IDS: '',
    GITHUB_APP_ID: '1',
    GITHUB_INSTALLATION_ID: '2',
    GITHUB_PRIVATE_KEY: '',
    GITHUB_REPOSITORY: 'owner/site',
    GITHUB_BRANCH: 'main',
  };
  const canEdit = createAccessCheck(
    async () => assert.fail('hosting access never asks GitHub for repository permission'),
    Date.now,
    async (identity) => (identity.id === 1 ? 'content' : null),
  );
  assert.equal(await canEdit({ id: 1, login: 'client' }, config), true);
  assert.equal(await canEdit({ id: 2, login: 'stranger' }, config), false);
});

async function roomFor(roles: ReadonlyArray<AccessRole>) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-roles-'));
  await mkdir(path.join(root, 'src/pages'), { recursive: true });
  const source = await readFile(new URL('./fixtures/homepage.astro', import.meta.url), 'utf8');
  await writeFile(path.join(root, 'src/pages/index.astro'), source);
  const room = new Room(root, 'src/pages/index.astro');
  await room.initialize();
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const pending = [...roles];
  server.on('connection', (socket) => room.attach(socket, undefined, undefined, undefined, pending.shift()));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const clients: WebSocket[] = [];
  for (const _role of roles) {
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await once(client, 'open');
    clients.push(client);
  }
  return {
    room,
    source,
    clients,
    async close() {
      for (const client of clients) {
        client.terminate();
      }
      for (const socket of server.clients) {
        socket.terminate();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await room.durable.flush();
      room.document.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}

// Sends one message and reports the room's error, or undefined once the edit was acknowledged.
function send(client: WebSocket, message: Record<string, unknown>): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No answer from the room')), 5000);
    const receive = (bytes: Buffer) => {
      const answer = record(JSON.parse(bytes.toString()));
      if (answer['type'] === 'error' || answer['type'] === 'saved' || answer['type'] === 'ack') {
        clearTimeout(timer);
        client.off('message', receive);
        resolve(answer['type'] === 'error' ? String(answer['message']) : undefined);
      }
    };
    client.on('message', receive);
    client.send(JSON.stringify(message));
  });
}

test('the editing server refuses structure from Content and anything outside the layout from Layout', async () => {
  const state = await roomFor(['content', 'layout', 'full']);
  const [content, layout, full] = state.clients;
  assert.ok(content && layout && full);
  try {
    const epoch = state.room.document.getMap('metadata').get('epoch');
    const heading = flatten(nodesOf(state.room.text.toString())).find((node) => node.name === 'Heading');
    assert.ok(heading?.id);
    const action = (node: string, kind: 'duplicate' | 'delete') => ({
      type: 'action',
      epoch,
      save: 1,
      checksum: checksum(state.room.text.toString()),
      action: { kind, node },
    });
    assert.match((await send(content, action(heading.id, 'duplicate'))) ?? '', /Content access/);
    assert.match((await send(layout, action('layout', 'delete'))) ?? '', /layout/);
    const before = state.room.text.toString();
    assert.equal(await send(layout, action(heading.id, 'duplicate')), undefined, 'Layout duplicates inside the layout');
    assert.notEqual(state.room.text.toString(), before);

    // A raw text update that bypasses the editor: removing the layout is refused for Layout.
    const probe = new Y.Doc();
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(state.room.document));
    const vector = Y.encodeStateVector(probe);
    const text = probe.getText('source');
    text.delete(0, text.length);
    text.insert(0, '<h1>Replaced</h1>');
    const update = Buffer.from(Y.encodeStateAsUpdate(probe, vector)).toString('base64');
    probe.destroy();
    assert.match((await send(layout, { type: 'update', epoch, save: 2, update })) ?? '', /layout/);
    assert.equal(await send(full, { type: 'update', epoch, save: 3, update }), undefined, 'Full access may rewrite the page');
    assert.equal(state.room.text.toString(), '<h1>Replaced</h1>');
  } finally {
    await state.close();
  }
});
