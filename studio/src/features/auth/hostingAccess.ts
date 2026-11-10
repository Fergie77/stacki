import { record } from '../../shared/validation';
import { parseAccessRole, type AccessRole } from '../roles/accessRole';
import type { Identity } from './session';

// EDITOR_ACCESS=hosting: a hosting service (for example an agency's client portal) decides who
// may edit and with which role, by GitHub user ID. Studio asks
//   GET HOSTING_ROLE_URL?github_id=<id>   Authorization: Bearer <HOSTING_KEY>
// and expects 200 { github_id, role } or 404 for no access. People need no repository access,
// so a role cannot be bypassed by pushing to the repository.
export interface HostingAccessConfig {
  readonly HOSTING_ROLE_URL?: string;
  readonly HOSTING_KEY?: string;
}

export type RoleLookup = (url: URL, key: string, githubId: number) => Promise<AccessRole | null>;

const CACHE_ENTRIES_MAX = 500;
// Short, so a changed or removed role applies within a minute (sockets recheck too).
const GRANT_TTL_MS = 60_000;
const DENIAL_TTL_MS = 15_000;

export function createHostingRoles(lookup: RoleLookup, now: () => number = Date.now) {
  const cache = new Map<string, { readonly role: AccessRole | null; readonly until: number }>();
  return async (identity: Pick<Identity, 'id'>, config: HostingAccessConfig, fresh = false): Promise<AccessRole | null> => {
    const url = hostingURL(config.HOSTING_ROLE_URL);
    const key = config.HOSTING_KEY ?? '';
    if (!url || key.length < 32) {
      throw new Error('EDITOR_ACCESS=hosting needs an https HOSTING_ROLE_URL and the HOSTING_KEY secret');
    }
    const cacheKey = `${url.href}:${identity.id}`;
    const cached = cache.get(cacheKey);
    if (!fresh && cached && cached.until > now()) {
      return cached.role;
    }
    const role = await lookup(url, key, identity.id);
    if (cache.size >= CACHE_ENTRIES_MAX) {
      cache.clear();
    }
    cache.set(cacheKey, { role, until: now() + (role ? GRANT_TTL_MS : DENIAL_TTL_MS) });
    return role;
  };
}

function hostingURL(value: string | undefined): URL | undefined {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the hosting service's answer. Anything unexpected is an error, never a grant. */
export async function readRoleResponse(response: Response, githubId: number): Promise<AccessRole | null> {
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Could not check editing access. Please retry.');
  }
  const data = record(await response.json());
  const role = parseAccessRole(data['role']);
  if (!role || data['github_id'] !== githubId) {
    throw new Error('The hosting service answered with an unexpected role.');
  }
  return role;
}

export const hostingRole = createHostingRoles(async (url, key, githubId) => {
  const target = new URL(url);
  target.searchParams.set('github_id', String(githubId));
  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'Astro-Studio' },
    signal: AbortSignal.timeout(10_000),
  });
  return readRoleResponse(response, githubId);
});
