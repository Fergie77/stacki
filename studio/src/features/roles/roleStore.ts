import { allowsCode, allowsStructure, editorRoleFor, type AccessRole } from './accessRole';

export type EditorRole = 'designer' | 'client';
const listeners = new Set<() => void>();
let current: EditorRole | undefined;
// Granted by the Worker (accessRole.ts). Local editing and Studios without roles are full.
let access: AccessRole = 'full';

export function getEditorRole(): EditorRole {
  if (current) {
    return current;
  }
  try {
    current = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('studio-role') === 'client' ? 'client' : 'designer';
  } catch {
    current = 'designer';
  }
  return current;
}
export function setEditorRole(role: EditorRole) {
  // Only full access may preview another editing mode; everyone else edits as their role.
  if (access !== 'full') {
    return;
  }
  current = role;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('studio-role', role);
    }
  } catch {
    /* Role switching also works when browser storage is unavailable. */
  }
  for (const listener of listeners) {
    listener();
  }
}
export function subscribeRole(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function clientPanel(panel: string | undefined) {
  return !['code', 'variables', 'properties', 'ai'].includes(panel ?? '');
}

export function getAccessRole(): AccessRole {
  return access;
}
/** Applies the role the signed-in person was granted. Without full access it cannot be switched. */
export function setAccessRole(role: AccessRole) {
  access = role;
  if (role !== 'full') {
    current = editorRoleFor(role);
  }
  for (const listener of listeners) {
    listener();
  }
}
/** Whether this person may open a rail panel, by editing mode and role. */
export function panelAllowed(panel: string | undefined): boolean {
  if (panel === 'components' && !allowsStructure(access)) {
    return false;
  }
  if ((panel === 'code' || panel === 'ai') && !allowsCode(access)) {
    return false;
  }
  return getEditorRole() !== 'client' || clientPanel(panel);
}
/** The code window: never in Client mode, and only with full access. */
export function codeAllowed(): boolean {
  return getEditorRole() !== 'client' && allowsCode(access);
}
