import { useEffect, useState } from 'react';
import { request } from '../project/projectClient';
import { record } from '../../shared/validation';
import { parseProfile, type GitHubProfile } from './profile';
import { parseAccessRole, type AccessRole } from '../roles/accessRole';
import { setAccessRole } from '../roles/roleStore';

export type Session =
  { readonly kind: 'local'; readonly editing: 'source' | 'draft' } | (GitHubProfile & { readonly kind: 'github'; readonly access: AccessRole });

export function parseSession(value: unknown): Session {
  const data = record(value);
  if (data['kind'] === 'local') {
    const editing = data['editing'] ?? 'draft';
    if (editing !== 'source' && editing !== 'draft') {
      throw new Error('Invalid local editing mode');
    }
    return { kind: 'local', editing };
  }
  if (data['kind'] !== 'github') {
    throw new Error('Invalid Studio session');
  }
  // A Worker from before roles sends no access: full, as then. An unknown role gets the least.
  const access = data['access'] === undefined ? 'full' : (parseAccessRole(data['access']) ?? 'content');
  return { kind: 'github', ...parseProfile(data), access };
}

export function useSession(report: (error: unknown) => void) {
  const [session, setSession] = useState<Session>();
  useEffect(() => {
    let active = true;
    void request('/studio/api/session')
      .then((value) => {
        if (!active) {
          return;
        }
        const parsed = parseSession(value);
        if (parsed.kind === 'github') {
          setAccessRole(parsed.access);
        }
        setSession(parsed);
      })
      .catch((error: unknown) => {
        if (active) {
          report(error);
        }
      });
    return () => {
      active = false;
    };
  }, [report]);
  return session;
}
