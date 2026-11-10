import type { AuthConfig } from '../features/auth/githubLogin';
import type { PreviewContainer, StudioSessions } from './worker';

export interface Environment extends AuthConfig {
  readonly EDITOR_ACCESS?: string;
  // EDITOR_ACCESS=hosting: where roles come from (features/auth/hostingAccess.ts).
  readonly HOSTING_ROLE_URL?: string;
  readonly HOSTING_KEY?: string;
  readonly SITE_DEPLOYMENT_URL?: string;
  readonly GITHUB_DEPLOY_WORKER?: string;
  readonly GITHUB_DEPLOY_ACCOUNT?: string;
  readonly PUBLISH_CLOUDFLARE_API_TOKEN?: string;
  readonly PUBLISH_VERCEL_TOKEN?: string;
  readonly AI_BASE_URL?: string;
  readonly AI_MODEL?: string;
  readonly AI_MODELS?: string;
  readonly AI_API_KEY?: string;
  // Exactly one editing-server backend is configured (studioBackend.ts): the PREVIEW
  // Container, or a self-hosted STUDIO_SERVER_HOST with SESSIONS for sign-in state.
  readonly PREVIEW?: DurableObjectNamespace<PreviewContainer>;
  readonly SESSIONS?: DurableObjectNamespace<StudioSessions>;
  readonly STUDIO_SERVER_HOST?: string;
  readonly DRAFTS: R2Bucket;
  readonly ASSETS: Fetcher;
  readonly PREVIEW_ORIGIN: string;
  readonly CONTAINER_TOKEN: string;
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_INSTALLATION_ID: string;
  readonly GITHUB_PRIVATE_KEY: string;
  readonly GITHUB_REPOSITORY: string;
  readonly GITHUB_BRANCH: string;
}
