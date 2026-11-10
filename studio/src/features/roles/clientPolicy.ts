import { bounds, flatten, nodesOf, type ParserNode, type TreeAction } from '../source/source';
import { frontmatterRange } from '../source/frontmatter';

export function clientLayout(source: string) {
  return layoutOf(nodesOf(source));
}
export function layoutOf(nodes: readonly ParserNode[]) {
  const layout = nodes.find((node) => node.id === 'layout' && node.kind === 'component');
  if (!layout) {
    throw new Error('Client editing requires a page layout. Ask a developer to set one up.');
  }
  return layout;
}
export function assertClientAction(source: string, action: TreeAction) {
  const layout = clientLayout(source);
  const children = new Set(flatten(layout.children ?? []).map((node) => node.id));
  if ('node' in action && !children.has(action.node)) {
    throw new Error('Client mode keeps the page layout and everything outside it protected.');
  }
  if ('target' in action) {
    const insideLayout = action.target === layout.id && (!action.placement || action.placement === 'inside');
    if (!insideLayout && !children.has(action.target)) {
      throw new Error('Add and move elements inside the page layout in Client mode.');
    }
  }
}

// Files Client mode may change through a document. Pages are checked below; Markdown is
// prose. Everything else a room can open (scripts, styles, config, data, MDX, which runs
// components) is code or design, and changing it would run code at build time.
const CLIENT_PROSE = /\.(md|markdown)$/i;

export function assertClientSourceChange(file: string, before: string, after: string) {
  if (!file.endsWith('.astro')) {
    assertClientFile(file);
    return;
  }
  if (!file.startsWith('src/pages/')) {
    throw new Error('Component source is protected in Client mode.');
  }
  assertLayoutKept(before, after, clientLayout(before), clientLayout(after));
  assertFrontmatterKept(before, after, 'component');
}
export function assertClientFile(file: string) {
  if (!CLIENT_PROSE.test(file)) {
    throw new Error('Only pages and Markdown can be edited in Client mode.');
  }
}

/** The layout survives, and authored markup outside it stays byte-for-byte intact. */
export function assertLayoutKept(before: string, after: string, previous: ParserNode, next: ParserNode) {
  const left = bounds(previous);
  const right = bounds(next);
  const beforeStart = frontmatterRange(before)?.end ?? 0;
  const afterStart = frontmatterRange(after)?.end ?? 0;
  if (previous.name !== next.name) {
    throw new Error('Client mode cannot change the page layout or elements outside it.');
  }
  if (before.slice(beforeStart, left.start) !== after.slice(afterStart, right.start)) {
    throw new Error('Client mode cannot change the page layout or elements outside it.');
  }
  if (before.slice(left.end) !== after.slice(right.end)) {
    throw new Error('Client mode cannot change the page layout or elements outside it.');
  }
}

// Frontmatter runs at build time, so Client mode may only add or remove the imports its
// own edits write: an image or other asset (assetProp in settingsEdits.ts) and, for Layout,
// an Astro component it inserts. Any other line must stay exactly as it was.
const ASSET_EXTENSIONS = 'avif|gif|ico|jpe?g|mov|mp3|mp4|pdf|png|svg|webm|webp';
const ASSET_IMPORT = new RegExp(`^import\\s+[A-Za-z_$][\\w$]*\\s+from\\s+(['"])[^'"\\n?#]+\\.(?:${ASSET_EXTENSIONS})\\1;?\\s*$`, 'i');
const COMPONENT_IMPORT = /^import\s+[A-Za-z_$][\w$]*\s+from\s+(['"])[^'"\n?#]+\.astro\1;?\s*$/;
export const ASSET_PATH = new RegExp(`\\.(?:${ASSET_EXTENSIONS})$`, 'i');

/** Which imports a Client mode edit may add or remove. */
export type ImportAllowance = 'asset' | 'component';

export function assertFrontmatterKept(before: string, after: string, allowance: ImportAllowance) {
  const editable = (line: string) => ASSET_IMPORT.test(line) || (allowance === 'component' && COMPONENT_IMPORT.test(line));
  const kept = (source: string) => (frontmatterRange(source)?.value ?? '').split(/\r?\n/).filter((line) => !editable(line));
  const previous = kept(before);
  const next = kept(after);
  if (previous.length !== next.length || previous.some((line, index) => line !== next[index])) {
    throw new Error('Client mode can only add image and component imports to the page code.');
  }
}
