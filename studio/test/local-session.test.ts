// Goal: local source editing is explicit and cannot be confused with a hosted draft.
// Method: parse current and legacy session replies, rejecting malformed modes and identities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from '../src/features/auth/useSession';

test('local editing mode is validated with a legacy draft default', () => {
  assert.deepEqual(parseSession({ kind: 'local', editing: 'source' }), {
    kind: 'local',
    editing: 'source',
  });
  assert.deepEqual(parseSession({ kind: 'local' }), { kind: 'local', editing: 'draft' });
  // A Worker from before editing roles sends no access: full, as then.
  assert.deepEqual(parseSession({ kind: 'github', id: 123, login: 'editor' }), {
    kind: 'github',
    id: 123,
    login: 'editor',
    access: 'full',
  });
  assert.deepEqual(parseSession({ kind: 'github', id: 123, login: 'editor', access: 'layout' }), {
    kind: 'github',
    id: 123,
    login: 'editor',
    access: 'layout',
  });
  // An unknown role gets the least access, never more.
  const unknown = parseSession({ kind: 'github', id: 123, login: 'editor', access: 'owner' });
  assert.equal(unknown.kind === 'github' ? unknown.access : undefined, 'content');
  for (const value of [
    undefined,
    { kind: 'unknown' },
    { kind: 'local', editing: 'other' },
    { kind: 'local', editing: 1 },
    { kind: 'github', id: '123', login: 'editor' },
  ]) {
    assert.throws(() => parseSession(value));
  }
});
