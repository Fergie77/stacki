// Goal: the Worker reaches exactly one editing server, and a self-hosted one only through a
// hostname Cloudflare can override to (same zone, not the Worker's own routes).
// Method: parse the deployment settings for each supported and mistaken combination.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStudioBackend, type BackendSettings } from '../src/cloudflare/studioBackend';

const base: BackendSettings = {
  studioOrigin: 'https://edit-acme.example.com',
  previewOrigin: 'https://preview-acme.example.com',
  serverHost: undefined,
  hasContainer: true,
  hasSessions: false,
};

const self = (serverHost: string): BackendSettings => ({ ...base, serverHost, hasContainer: false, hasSessions: true });

test('the Cloudflare Container stays the default backend', () => {
  assert.deepEqual(parseStudioBackend(base), { ok: true, backend: { kind: 'container' } });
});

test('a self-hosted server under the editor domain is accepted', () => {
  assert.deepEqual(parseStudioBackend(self('studio-origin.example.com')), { ok: true, backend: { kind: 'origin', host: 'studio-origin.example.com' } });
  assert.deepEqual(parseStudioBackend(self(' studio.home.example.com ')), { ok: true, backend: { kind: 'origin', host: 'studio.home.example.com' } });
});

test('mistaken deployments are refused with a reason', () => {
  const refused = (settings: BackendSettings, reason: RegExp) => {
    const result = parseStudioBackend(settings);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, reason);
  };
  refused({ ...base, hasContainer: false }, /PREVIEW container binding, or STUDIO_SERVER_HOST/);
  refused({ ...self('studio-origin.example.com'), hasContainer: true }, /alongside the PREVIEW container/);
  refused({ ...self('studio-origin.example.com'), hasSessions: false }, /SESSIONS Durable Object/);
  refused(self('https://studio-origin.example.com'), /bare hostname/);
  refused(self('studio-origin.example.com:8443'), /bare hostname/);
  refused(self('Studio.Example.com'), /bare hostname/);
  refused(self('edit-acme.example.com'), /differ from the editor and preview/);
  refused(self('preview-acme.example.com'), /differ from the editor and preview/);
  refused(self('studio.elsewhere.net'), /under example\.com/);
  refused(self('example.com'), /under example\.com/);
  refused({ ...self('studio-origin.example.com'), studioOrigin: 'http://edit-acme.example.com' }, /https origins/);
  refused({ ...self('studio-origin.example.com'), previewOrigin: 'https://preview-acme.example.com/path' }, /https origins/);
});
