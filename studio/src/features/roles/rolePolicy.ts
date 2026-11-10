import type { TreeAction } from '../source/source';
import { allowsStructure, editorRoleFor, type AccessRole } from './accessRole';
import { assertClientAction, assertClientSourceChange } from './clientPolicy';
import { assertContentSourceChange } from './contentPolicy';

// What the editing server lets each role change (rooms.ts). The browser runs the same checks
// first (useDocument.ts) to answer without a round trip; these hold when it is bypassed.

/** The editing server's check for a structural action from a person with this role. */
export function assertRoleAction(role: AccessRole, source: string, action: TreeAction) {
  if (!allowsStructure(role)) {
    throw new Error('Content access changes text, images and links. Ask for Layout access to add, move or remove elements.');
  }
  if (editorRoleFor(role) === 'client') {
    assertClientAction(source, action);
  }
}
/** The editing server's check for a text change from a person with this role. */
export function assertRoleSourceChange(role: AccessRole, file: string, before: string, after: string) {
  if (before === after) {
    return;
  }
  if (role === 'content') {
    assertContentSourceChange(file, before, after);
    return;
  }
  if (editorRoleFor(role) === 'client') {
    assertClientSourceChange(file, before, after);
  }
}
