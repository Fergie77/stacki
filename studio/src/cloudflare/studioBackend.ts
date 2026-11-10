// Where the editing server runs.
//
// "container": a Cloudflare Container started by the PreviewContainer Durable Object.
// Containers need the Workers Paid plan.
//
// "origin": a self-hosted server (for example the Docker image on a home machine behind a
// Cloudflare Tunnel). The Worker reaches it with `resolveOverride`, which keeps the request's
// own URL and Host header (the editing server's Vite `allowedHosts` only accepts the editor
// and preview hostnames) while connecting to STUDIO_SERVER_HOST. Cloudflare only honours
// `resolveOverride` within the same zone, so that host must sit under the editor's domain.
// Sign-in state then lives in the plain StudioSessions Durable Object, so the Worker can stay
// on the free plan. See docs/self-hosting.md.

export type StudioBackend = { readonly kind: 'container' } | { readonly kind: 'origin'; readonly host: string };

export type BackendSettings = Readonly<{
  studioOrigin: string;
  previewOrigin: string;
  serverHost: string | undefined;
  hasContainer: boolean;
  hasSessions: boolean;
}>;

export type BackendResult = { readonly ok: true; readonly backend: StudioBackend } | { readonly ok: false; readonly error: string };

// A DNS hostname: lower-case labels of letters, digits and inner hyphens. No scheme, port or path.
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseStudioBackend(settings: BackendSettings): BackendResult {
  const editor = hostnameOf(settings.studioOrigin);
  const preview = hostnameOf(settings.previewOrigin);
  if (!editor || !preview) {
    return { ok: false, error: 'STUDIO_ORIGIN and PREVIEW_ORIGIN must be https origins' };
  }
  const host = settings.serverHost?.trim() ?? '';
  if (host === '') {
    return settings.hasContainer
      ? { ok: true, backend: { kind: 'container' } }
      : { ok: false, error: 'Configure the PREVIEW container binding, or STUDIO_SERVER_HOST with the SESSIONS binding' };
  }
  if (settings.hasContainer) {
    // One backend at a time: two would leave drafts split between servers.
    return { ok: false, error: 'STUDIO_SERVER_HOST is set alongside the PREVIEW container binding; remove one' };
  }
  if (!settings.hasSessions) {
    return { ok: false, error: 'STUDIO_SERVER_HOST needs the SESSIONS Durable Object binding for sign-in' };
  }
  if (!HOSTNAME.test(host)) {
    return { ok: false, error: 'STUDIO_SERVER_HOST must be a bare hostname such as studio-origin.example.com' };
  }
  if (host === editor || host === preview) {
    // The override would point back at the Worker's own route.
    return { ok: false, error: 'STUDIO_SERVER_HOST must differ from the editor and preview hostnames' };
  }
  const zone = parentDomain(editor);
  if (!zone || !host.endsWith(`.${zone}`)) {
    return { ok: false, error: `STUDIO_SERVER_HOST must be under ${zone ?? 'the editor domain'} (resolveOverride works within one zone)` };
  }
  return { ok: true, backend: { kind: 'origin', host } };
}

function hostnameOf(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

// edit-acme.example.com → example.com. A one-label host has no parent.
function parentDomain(hostname: string): string | undefined {
  const dot = hostname.indexOf('.');
  const parent = dot === -1 ? '' : hostname.slice(dot + 1);
  return parent.includes('.') ? parent : undefined;
}
