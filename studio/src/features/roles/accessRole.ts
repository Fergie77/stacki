import type { EditorRole } from './roleStore';

// What a signed-in person may change on this site. A hosting service decides it per person
// (EDITOR_ACCESS=hosting, hostingAccess.ts); every other access mode grants "full", which is
// Studio's behaviour without roles. The Worker passes the role to the editing server, which
// enforces it (rooms.ts, integration.ts); the editor hides what a role cannot use.
//
//   content  text, images and links inside the page layout; no adding, moving or deleting
//   layout   content, plus adding, moving, duplicating and deleting inside the page layout
//   design   everything in the visual editor: styles, variables, components, pages
//   full     design, plus code, AI proposals, Git and publish settings
export const ACCESS_ROLES = ['content', 'layout', 'design', 'full'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

export const ACCESS_ROLE_LABEL: Readonly<Record<AccessRole, string>> = {
  content: 'Content',
  layout: 'Layout',
  design: 'Design',
  full: 'Full access',
};

export function parseAccessRole(value: unknown): AccessRole | undefined {
  return ACCESS_ROLES.find((role) => role === value);
}

/** Content and Layout edit inside the page layout, as Client mode does; Design and Full use the developer editor. */
export function editorRoleFor(role: AccessRole): EditorRole {
  return role === 'content' || role === 'layout' ? 'client' : 'designer';
}

/** Adding, moving, duplicating and deleting elements. */
export function allowsStructure(role: AccessRole): boolean {
  return role !== 'content';
}

/** The code window, AI proposals and anything else that writes arbitrary source. */
export function allowsCode(role: AccessRole): boolean {
  return role === 'full';
}

// Writes a role may not make. Reads are always allowed: the editor needs them to render.
// Paths ending in "/" cover everything beneath them.
const FULL_ONLY: ReadonlyArray<string> = [
  '/studio/api/ai/',
  '/studio/api/git/',
  '/studio/api/history/commit',
  '/studio/api/import-source',
  '/studio/api/publish/account',
  '/studio/api/publish/discover',
  '/studio/api/publish/repository',
  '/studio/api/publish/site-url',
  '/studio/api/storage/cleanup',
];
const DESIGN_AND_UP: ReadonlyArray<string> = [
  '/studio/api/component-properties',
  '/studio/api/create',
  '/studio/api/defaults-canvas',
  '/studio/api/pages/rename',
  '/studio/api/source',
  '/studio/api/variables',
];

function matches(pathname: string, rules: ReadonlyArray<string>): boolean {
  return rules.some((rule) => (rule.endsWith('/') ? pathname.startsWith(rule) : pathname === rule));
}

/** Whether a role may make this HTTP request to the editing server. */
export function allowsRequest(role: AccessRole, method: string, pathname: string): boolean {
  if (role === 'full' || method === 'GET' || method === 'HEAD') {
    return true;
  }
  if (matches(pathname, FULL_ONLY)) {
    return false;
  }
  return role === 'design' || !matches(pathname, DESIGN_AND_UP);
}
