/**
 * Where the AI stages of the content check (KI-Prüfung) and of the plan reader
 * (KI-Plan-Leser) may run.
 *
 * Until the go-live they ran only where the content upload runs
 * (contentUploadAvailability: not in Production). The owner decided that they come with the
 * go-live to Production. The switch CONTENT_CHECK_KI_PRODUCTION=true (environment variable,
 * default off) allows them there as well. The switch is NOT set in Production before the
 * go-live and is set with it, together with OPENAI_COMPATIBLE_MODEL (docs/go-checkliste.md).
 *
 * What the switch does NOT change:
 *  - the right: the routes stay for the platform admin (requireCurriculumEditor)
 *  - the target: Sokrates only (positive list of hosts, https, key from the environment)
 *  - the budget, the guard before every request and the circuit breaker
 *  - the content upload itself: it stays off in Production
 *
 * Only exactly "true" counts, and only in Production (Vercel production, or a production
 * build outside of Vercel). In every other environment the rule of the content upload
 * decides as before, so the switch can neither turn a Preview on that is off (wrong schema)
 * nor open an unknown environment (fail closed).
 */

import { IS_PREVIEW_SCHEMA } from '@/lib/db-schema';
import { KI_ENV, type Env } from '@/lib/content-upload/ki/config';
import { evaluateAvailability } from '@/lib/content-upload/staging/config';

export const CONTENT_CHECK_KI_PRODUCTION_ENV = 'CONTENT_CHECK_KI_PRODUCTION';

const lower = (value: string | undefined) => (value ?? '').trim().toLowerCase();

/** Whether this environment is Production and the switch is on. Pure. */
export function productionSwitchOn(env: Env): boolean {
  if (env[CONTENT_CHECK_KI_PRODUCTION_ENV] !== 'true') return false;
  const vercel = lower(env.VERCEL_ENV);
  const node = lower(env.NODE_ENV);
  return vercel === 'production' || (vercel === '' && node === 'production');
}

/**
 * Whether the AI stages may run here. Pure, takes the environment as an argument so a test
 * can try every case. `previewSchema` is the schema fact of the deployment (default: read
 * from the build).
 */
export function contentCheckKiAvailable(
  env: Env = process.env,
  previewSchema: boolean = IS_PREVIEW_SCHEMA
): boolean {
  if (
    evaluateAvailability({
      vercelEnv: env.VERCEL_ENV,
      nodeEnv: env.NODE_ENV,
      previewSchema,
    }).enabled
  ) {
    return true;
  }
  return productionSwitchOn(env);
}

/**
 * The environment the AI configuration reads. In Production with the switch on, the
 * owner's switch of the AI stage (CONTENT_UPLOAD_KI_ENABLED) counts as set, so one
 * variable is enough there. Everywhere else the environment is passed on unchanged.
 */
export function contentCheckKiEnv(env: Env = process.env): Env {
  return productionSwitchOn(env) ? { ...env, [KI_ENV.enabled]: 'true' } : env;
}
