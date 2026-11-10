// Goal: a hosted preview, loaded through the Worker's sign-in hand-off, becomes ready.
// The ready message names the page the frame shows, so the hand-off URL must name the
// same page (PreviewLoading.tsx, pagePath).
// Method: compare the page each kind of preview URL names with the page a frame reports.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pagePath } from '../src/features/preview/PreviewLoading';

const base = 'https://edit.example.com/studio';

test('the sign-in hand-off names the page it redirects to', () => {
  const entry = (page: string) => `https://preview.example.com/__studio-entry?token=abc.def&page=${encodeURIComponent(page)}`;
  assert.equal(pagePath(entry('/'), base), '/');
  assert.equal(pagePath(entry('/about'), base), '/about');
  assert.equal(pagePath(entry('/blog/post?draft=1'), base), '/blog/post?draft=1');
  assert.equal(pagePath(`${entry('/about')}&mode=interactive`, base), '/about');
});

test('ordinary preview URLs keep naming themselves', () => {
  assert.equal(pagePath('http://localhost:4350/#avb-design', base), '/');
  assert.equal(pagePath('/about?x=1#avb-preview', base), '/about?x=1');
});

test('a hand-off without a usable page is taken as written', () => {
  assert.equal(pagePath('https://preview.example.com/__studio-entry?token=abc', base), '/__studio-entry?token=abc');
  assert.equal(pagePath('https://preview.example.com/__studio-entry?page=%2F%2Fevil.example', base), '/__studio-entry?page=%2F%2Fevil.example');
  assert.equal(pagePath('https://preview.example.com/__studio-entry?page=https%3A%2F%2Fevil.example', base), '/__studio-entry?page=https%3A%2F%2Fevil.example');
});
