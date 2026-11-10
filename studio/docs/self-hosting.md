# Self-hosting the editing server

Studio's editing server is the Docker image built from `Dockerfile`. Normally a Cloudflare
Container runs it, which needs Workers Paid. It can instead run on a machine you control,
such as a home server with Docker. The Worker keeps sign-in, sessions, the GitHub App key and
draft storage on Cloudflare, and stays on the free plan.

```
browser ──> Worker (edit.example.com, preview-edit.example.com)
              │  sign-in, sessions, R2 drafts, GitHub App
              └─ fetch(…, { cf: { resolveOverride: STUDIO_SERVER_HOST } })
                    └─ Cloudflare Tunnel ──> docker: node dist/container.mjs :4350
```

The server holds no long-lived secrets. It starts by calling the Worker's
`/studio/internal/*` routes with `CONTAINER_TOKEN`, and rejects any request without it.

## How requests reach your machine

`resolveOverride` keeps each request's own URL and `Host`, so the server's Vite
`allowedHosts` (the editor and preview hostnames) still match. Cloudflare only allows it
within one zone, so `STUDIO_SERVER_HOST` must be under the editor's domain. The Worker refuses
to start with a mistaken combination (`src/cloudflare/studioBackend.ts`).

## Setup

1. Copy `cloudflare/wrangler.homelab.jsonc` and fill in the origins, the route patterns,
   `STUDIO_SERVER_HOST`, and the GitHub App values (see `cloudflare.md`). Create the R2 bucket.
2. In the zone, add proxied DNS records for the editor and preview hostnames so the Worker
   routes receive traffic. An `AAAA` record to `100::` is enough, because the Worker answers
   every request.
3. Create a Cloudflare Tunnel. Give it the public hostname `STUDIO_SERVER_HOST`, and add
   ingress rules for the editor and preview hostnames too (requests arrive with their `Host`).
   Point all of them at the server, for example `http://studio:4350` on a Docker network.
4. Set the secrets as in `cloudflare.md` (`GITHUB_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`,
   `SESSION_SECRET`, `CONTAINER_TOKEN`), then
   `npx wrangler deploy --config cloudflare/wrangler.homelab.jsonc`.
5. Run the image with the environment the Container would have received:
   `STUDIO_CONTAINER_TOKEN` (the same value as `CONTAINER_TOKEN`), `STUDIO_BACKEND_URL` and
   `STUDIO_PARENT_ORIGIN` (both the editor origin), `STUDIO_PREVIEW_ORIGIN`,
   `GITHUB_REPOSITORY` and `PORT=4350`. Publishing tokens are optional, as in `worker.ts`.

## Differences from the Container

- The server runs all the time; there is no three-minute sleep or idle publish guard.
- Free Workers have a 10 ms CPU limit per request. If GitHub App token signing exceeds it,
  the Worker needs Workers Paid (still without Containers).

## Security

The server runs the website's code (`npm ci`, `astro dev`) and code proposed in the editor.
Anyone who can edit can run code on that machine. Run it as an unprivileged container with no
host mounts, no Docker socket, resource limits, and a firewall that blocks it from your other
machines. Never expose it except through the Tunnel.
