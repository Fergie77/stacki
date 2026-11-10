import { assert } from '../../../vendor/stacki/shared/core/assert';
import type { Attr } from '../../../vendor/stacki/shared/page/pageNodeTypes';
import { flatten, parsePage, type ParserNode } from '../source/source';
import { ASSET_PATH, assertClientFile, assertFrontmatterKept, assertLayoutKept, layoutOf } from './clientPolicy';

// Content access changes text, images and links, and nothing else (accessRole.ts). The
// editor only offers those edits, but the editing server receives raw text updates, so it
// checks the page itself: parsed before and after, the tree inside the layout must keep
// its shape. What may differ:
//
//   text          any text node's words
//   rich text     inside an element that holds only text and inline tags (strong, a, br…),
//                 those tags may be added, removed or rearranged, as the text editor does
//   content props a prop named for words, a link or an image (CONTENT_PROPS) may change,
//                 appear or disappear: a string, or an imported image for an image prop
//
// Everything else (element names, other props, classes, styles, loops, expressions, the
// layout and what lies outside it) must stay as it was. Comments are ignored: they render
// nothing, and the editor's element labels are written as comments.
//
// Cost: one parse of each version per update, as the Client mode check already made.

const CONTENT_PROPS = [
  'alt',
  'caption',
  'description',
  'eyebrow',
  'heading',
  'href',
  'label',
  'legend',
  'message',
  'placeholder',
  'subtitle',
  'target',
  'text',
  'title',
];
const IMAGE_PROPS = ['image', 'poster', 'src'];
// The tags the rich text editor writes (settingsEdits.ts serializeInline).
const INLINE_TAGS: ReadonlySet<string> = new Set(['a', 'b', 'br', 'code', 'em', 'i', 'mark', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u']);
const INLINE_PROPS: ReadonlySet<string> = new Set(['href', 'rel', 'target', 'title']);
const COMPARED_NODES_MAX = 10_000;
const BINDING = /^([A-Za-z_$][\w$]*)(?:\.src)?$/;

export function assertContentSourceChange(file: string, before: string, after: string) {
  if (!file.endsWith('.astro')) {
    assertClientFile(file);
    return;
  }
  if (!file.startsWith('src/pages/')) {
    throw new Error('Component source is protected in Client mode.');
  }
  const previous = parsed(before);
  const next = parsed(after);
  const previousLayout = layoutOf(previous.nodes);
  const nextLayout = layoutOf(next.nodes);
  assertLayoutKept(before, after, previousLayout, nextLayout);
  assertFrontmatterKept(before, after, 'asset');
  // The layout's own settings (its theme, say) are inside its bounds, so they are checked here.
  assertContentProps(previousLayout.props ?? {}, nextLayout.props ?? {}, next.assets);
  assertSameShape(previousLayout.children ?? [], nextLayout.children ?? [], next.assets);
}

function parsed(source: string) {
  const page = parsePage(source, { locs: true });
  if (!page.editable) {
    throw new Error(page.reason);
  }
  const assets = new Set(page.model.imports.filter((entry) => ASSET_PATH.test(entry.path)).map((entry) => entry.name));
  return { nodes: page.model.nodes, assets };
}

/** Walks both trees side by side; every pair must match by the rules above. */
function assertSameShape(before: readonly ParserNode[], after: readonly ParserNode[], assets: ReadonlySet<string>) {
  const pending: [readonly ParserNode[], readonly ParserNode[]][] = [[before, after]];
  let compared = 0;
  while (pending.length > 0) {
    const pair = pending.pop();
    assert(pair, 'a pending pair exists while the queue is not empty');
    const left = pair[0].filter(rendered);
    const right = pair[1].filter(rendered);
    if (left.length !== right.length) {
      throw shapeError();
    }
    compared += left.length;
    if (compared > COMPARED_NODES_MAX) {
      throw new Error('This page is too large to check. Ask for Layout access to edit it.');
    }
    for (const [index, previous] of left.entries()) {
      const next = right[index];
      assert(next, 'both lists have the same length');
      const children = matchNode(previous, next, assets);
      if (children) {
        pending.push(children);
      }
    }
  }
}

/** Checks one pair of nodes; returns their children when those must match too. */
function matchNode(previous: ParserNode, next: ParserNode, assets: ReadonlySet<string>): [readonly ParserNode[], readonly ParserNode[]] | undefined {
  if (previous.kind !== next.kind) {
    throw shapeError();
  }
  switch (previous.kind) {
    case 'text':
      return undefined;
    case 'component':
    case 'element': {
      if (previous.name !== next.name || previous.dynamicTag !== next.dynamicTag) {
        throw shapeError();
      }
      assertContentProps(previous.props ?? {}, next.props ?? {}, assets);
      const left = previous.children;
      const right = next.children;
      if (left === undefined || right === undefined) {
        if (left !== right) {
          throw shapeError();
        }
        return undefined;
      }
      if (isRichText(left)) {
        assertRichText(left, right);
        return undefined;
      }
      return [left, right];
    }
    case 'cond':
    case 'branch':
    case 'chunk-group':
      if (previous.test !== next.test || previous.op !== next.op || previous.name !== next.name || previous.chunkFile !== next.chunkFile) {
        throw shapeError();
      }
      return [previous.children ?? [], next.children ?? []];
    case 'expr':
    case 'raw-line':
    case 'comment':
    case 'raw':
    case 'map':
      // Code, or a loop whose body is code: unchanged, apart from where it sits.
      if (JSON.stringify(withoutPosition(previous)) !== JSON.stringify(withoutPosition(next))) {
        throw shapeError();
      }
      return undefined;
    default: {
      const exhaustive: never = previous;
      return exhaustive;
    }
  }
}

function assertContentProps(previous: Readonly<Record<string, Attr>>, next: Readonly<Record<string, Attr>>, assets: ReadonlySet<string>) {
  const names = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const name of names) {
    const left = previous[name];
    const right = next[name];
    if (sameAttr(left, right)) {
      continue;
    }
    if (right === undefined) {
      if (!isContentProp(name) && !isImageProp(name)) {
        throw propError(name);
      }
      continue;
    }
    if (!allowedValue(name, right, assets)) {
      throw propError(name);
    }
  }
}

/** A value Content may write to this prop: words or a link, or an imported image. */
function allowedValue(name: string, value: Attr, assets: ReadonlySet<string>): boolean {
  if (value.type === 'string') {
    if (isContentProp(name) || isImageProp(name)) {
      return safeLink(value.value);
    }
    return false;
  }
  if (value.type === 'expr') {
    if (isImageProp(name)) {
      const binding = BINDING.exec(value.value.trim())?.[1];
      return binding !== undefined && assets.has(binding);
    }
    return false;
  }
  return false;
}

// Named like a content prop: exactly ("alt") or as its last camel-case word ("imageAlt",
// "buttonLabel"). "context" does not end in the word "Text", so it is not one.
function isContentProp(name: string): boolean {
  return namedFor(name, CONTENT_PROPS);
}
function isImageProp(name: string): boolean {
  return namedFor(name, IMAGE_PROPS);
}
function namedFor(name: string, words: readonly string[]): boolean {
  return words.some((word) => name === word || (name.endsWith(word[0]?.toUpperCase() + word.slice(1)) && name.length > word.length));
}

// A link a visitor could be tricked by runs script on the client's own site.
function safeLink(value: string): boolean {
  return !/^\s*(javascript|vbscript|data):/i.test(value.replace(/[\u0000-\u001f]/g, ''));
}

/** Whether these children are prose the rich text editor owns: text and inline tags only. */
function isRichText(children: readonly ParserNode[]): boolean {
  return flatten(children).every((node) => node.kind === 'text' || node.kind === 'comment' || inlineElement(node));
}
function inlineElement(node: ParserNode): boolean {
  return node.kind === 'element' && INLINE_TAGS.has(node.name);
}

// The rich text editor rewrites the whole run (settingsEdits.ts inlineContentEdit). It keeps
// the props an inline tag already had, so those may reappear anywhere in the run; new ones
// are limited to links. Expressions are kept as they were written, never invented.
function assertRichText(previous: readonly ParserNode[], next: readonly ParserNode[]) {
  const before = flatten(previous);
  const after = flatten(next);
  const exprs = new Set(before.flatMap((node) => (node.kind === 'expr' ? [node.value] : [])));
  const props = new Set(before.flatMap((node) => Object.entries(node.props ?? {}).map(([name, value]) => attrKey(name, value))));
  for (const node of after) {
    if (node.kind === 'text' || node.kind === 'comment') {
      continue;
    }
    if (node.kind === 'expr' && exprs.has(node.value)) {
      continue;
    }
    if (!inlineElement(node)) {
      throw new Error('Content access edits text inside this element, not other elements. Ask for Layout access.');
    }
    for (const [name, value] of Object.entries(node.props ?? {})) {
      if (props.has(attrKey(name, value))) {
        continue;
      }
      if (!INLINE_PROPS.has(name) || value.type !== 'string' || !safeLink(value.value)) {
        throw propError(name);
      }
    }
  }
}

function rendered(node: ParserNode): boolean {
  return node.kind !== 'comment';
}
function sameAttr(left: Attr | undefined, right: Attr | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return attrKey('', left) === attrKey('', right);
}
function attrKey(name: string, value: Attr): string {
  return JSON.stringify([name, value.type, 'value' in value ? value.value : '']);
}
// Where a node sits changes whenever text before it does; what it is must not.
function withoutPosition(node: ParserNode): Record<string, unknown> {
  const { start: _start, end: _end, id: _id, attrSpans: _spans, blankBefore: _before, blankAfter: _after, ...rest } = node;
  return rest;
}
function shapeError() {
  return new Error('Content access changes text, images and links. Ask for Layout access to add, move or remove elements.');
}
function propError(name: string) {
  return new Error(`Content access cannot change "${name}". Ask for Design access to change styles and settings.`);
}
