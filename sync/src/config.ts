import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  /** URL prefix the reverse proxy forwards to this service (not stripped). */
  basePath: string;
  publicDir: string;
  vendorDir: string;
  /** Microsoft Entra app registration (public client / SPA); optional, OneNote import is disabled without it. */
  msClientId: string;
  msTenant: string;
}

export function normalizeBasePath(raw: string | undefined): string {
  const p = '/' + (raw ?? '/sync').trim().replace(/^\/+|\/+$/g, '');
  return p === '/' ? '' : p;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    port: Number(env.PORT ?? 4100),
    basePath: normalizeBasePath(env.BASE_PATH),
    publicDir: env.PUBLIC_DIR ?? path.resolve(here, '../public'),
    vendorDir: env.VENDOR_DIR ?? path.resolve(here, '../node_modules/@simplewebauthn/browser/dist/bundle'),
    msClientId: env.MS_CLIENT_ID ?? '',
    msTenant: env.MS_TENANT ?? 'common',
  };
}
