// Configuration of the Sokrates stage of the content upload (package U5 of
// docs/ki-upload-konzept.md, 6.3 and 9.1 T7, T11, T20).
//
// The stage talks to ONE provider, the own AI Sokrates, and to nothing else. This
// module turns the environment into a validated target or says, with a stable code,
// why the stage stays off. It fails closed:
//
//   - the stage is OFF unless CONTENT_UPLOAD_KI_ENABLED is exactly "true" (the
//     switch of the owner, independent of the opt-in of a run)
//   - the address (OPENAI_COMPATIBLE_BASE_URL, the variable of the chat) must be
//     https, carry no credentials, no query and no fragment, use the standard port
//     and name a host of the positive list. A wrong value therefore never sends an
//     excerpt to a foreign provider
//   - the key (OPENAI_COMPATIBLE_API_KEY) is only read from the environment and
//     never leaves this module except as the value of the Authorization header
//
// Reading the environment is a pure function of its argument, so every case is
// testable without touching process.env.

/** The host of Sokrates, the same default as the chat of the HAI. */
export const SOKRATES_DEFAULT_BASE_URL =
  'https://sokrates.test-qualitaetsmanagement.com/api';

/** The positive list of hosts. Replaced (not extended) by CONTENT_UPLOAD_KI_ALLOWED_HOSTS. */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = Object.freeze([
  'sokrates.test-qualitaetsmanagement.com',
]);

/** The model of the chat when the variable is not set (same default as the HAI). */
export const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * How much the model may think before it answers (the request parameter
 * `reasoning_effort` of the OpenAI compatible endpoint). The models behind Sokrates
 * think by default and then spend the whole token limit on it: the answer comes back
 * empty. `none` switches the thinking off. The reasoning the model writes is never
 * read, kept or shown, whatever the value.
 */
export const REASONING_EFFORTS = Object.freeze([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
] as const);
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'none';

export const KI_ENV = Object.freeze({
  enabled: 'CONTENT_UPLOAD_KI_ENABLED',
  baseUrl: 'OPENAI_COMPATIBLE_BASE_URL',
  apiKey: 'OPENAI_COMPATIBLE_API_KEY',
  model: 'OPENAI_COMPATIBLE_MODEL',
  allowedHosts: 'CONTENT_UPLOAD_KI_ALLOWED_HOSTS',
  timeoutMs: 'CONTENT_UPLOAD_KI_TIMEOUT_MS',
  reasoningEffort: 'CONTENT_UPLOAD_KI_REASONING_EFFORT',
  maxCallsPerRun: 'CONTENT_UPLOAD_KI_MAX_CALLS_PER_RUN',
  maxCallsPerDay: 'CONTENT_UPLOAD_KI_MAX_CALLS_PER_DAY',
} as const);

/** What a client may call: a parsed address and the rules it is held to. */
export interface KiTarget {
  /** The complete address of the chat completions endpoint. */
  url: string;
  /** Host with a port if it is not the standard one. Only this goes into the log. */
  host: string;
}

/** The rules a call is checked against right before it is made. */
export interface KiPolicy {
  /** Production: always true. Only a test with a local server turns it off. */
  requireHttps: boolean;
  /** Exact host names (lower case). Production: the positive list. */
  allowedHosts: readonly string[];
}

export interface KiLimits {
  /** One call, in milliseconds. */
  timeoutMs: number;
  /** The whole answer of the server, in bytes. */
  maxResponseBytes: number;
  /** Tokens of the answer (the schema needs about 100, a thinking model more). */
  maxTokens: number;
  /** Calls of one run (all statuses that reached the server). */
  maxCallsPerRun: number;
  /** Calls in the last 24 hours, over all runs. */
  maxCallsPerDay: number;
  /** Calls for one file, retries included. */
  maxCallsPerFile: number;
  /** Tries of the first call of a file (a retry is a later call of the pump). */
  maxAttempts: number;
  /** This many failures in a row pause the stage of the run. */
  breakerFailures: number;
  /** How long the pause lasts before the next try, in seconds. */
  breakerCooldownSec: number;
}

export const DEFAULT_LIMITS: Readonly<KiLimits> = Object.freeze({
  // the first call of a model that is not loaded yet takes 8 to 10 seconds
  timeoutMs: 30_000,
  maxResponseBytes: 32 * 1024,
  maxTokens: 400,
  maxCallsPerRun: 1500,
  maxCallsPerDay: 3000,
  maxCallsPerFile: 3,
  maxAttempts: 2,
  breakerFailures: 5,
  breakerCooldownSec: 600,
});

export interface KiConfig {
  target: KiTarget;
  policy: KiPolicy;
  /** Only for the Authorization header. Never log it, never store it. */
  apiKey: string;
  model: string;
  /** Sent as `reasoning_effort`. Never logged. */
  reasoningEffort: ReasoningEffort;
  limits: KiLimits;
}

/** The longest time limit of one call that the variable may set, in milliseconds. */
export const MAX_TIMEOUT_MS = 45_000;

export type KiConfigCode =
  | 'DISABLED'
  | 'NO_KEY'
  | 'BAD_URL'
  | 'HOST_NOT_ALLOWED'
  | 'BAD_HOSTS';

export type KiConfigResult =
  | { ok: true; config: KiConfig }
  | { ok: false; code: KiConfigCode };

export type Env = Readonly<Record<string, string | undefined>>;

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The positive list of hosts from the environment, or the default. Null: invalid. */
export function allowedHostsOf(env: Env): readonly string[] | null {
  const raw = env[KI_ENV.allowedHosts];
  if (raw === undefined || raw.trim() === '') return DEFAULT_ALLOWED_HOSTS;
  const hosts = raw
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(h => h.length > 0);
  if (hosts.length === 0 || hosts.length > 5) return null;
  // exact names with at least one dot: no localhost, no IP literal, no wildcard
  if (!hosts.every(h => HOSTNAME.test(h) && !/^\d+(\.\d+)*$/.test(h))) {
    return null;
  }
  return Object.freeze([...new Set(hosts)]);
}

/**
 * Checks an address against the rules and returns the target, or the code that
 * says what is wrong. Pure. The path of the address is kept (Sokrates answers under
 * /api), credentials, query and fragment are refused.
 */
export function parseTarget(
  baseUrl: string,
  policy: KiPolicy
): { ok: true; target: KiTarget } | { ok: false; code: KiConfigCode } {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, code: 'BAD_URL' };
  }
  if (policy.requireHttps && url.protocol !== 'https:') {
    return { ok: false, code: 'BAD_URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, code: 'BAD_URL' };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, code: 'BAD_URL' };
  }
  // production: the standard port only (a port is part of `host`)
  if (policy.requireHttps && url.port !== '') {
    return { ok: false, code: 'BAD_URL' };
  }
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  if (
    !policy.allowedHosts.includes(hostname) &&
    !policy.allowedHosts.includes(host)
  ) {
    return { ok: false, code: 'HOST_NOT_ALLOWED' };
  }
  const path = url.pathname.replace(/\/+$/, '');
  return {
    ok: true,
    target: {
      url: `${url.protocol}//${url.host}${path}/chat/completions`,
      host,
    },
  };
}

function intOf(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** The model name: plain characters only, it goes into the log and the request. */
function modelOf(raw: string | undefined): string {
  const name = (raw ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(name)
    ? name
    : DEFAULT_MODEL;
}

/**
 * The reasoning effort: one of the five known values, else the default. A value that
 * is not known is dropped without a trace (it is never logged or echoed).
 */
export function reasoningEffortOf(raw: string | undefined): ReasoningEffort {
  const value = (raw ?? '').trim().toLowerCase();
  return (
    REASONING_EFFORTS.find(known => known === value) ?? DEFAULT_REASONING_EFFORT
  );
}

/**
 * The configuration of the stage from the environment. `ok: false` means the
 * stage does not run, with the reason as a stable code (never the value of a
 * variable).
 */
export function loadKiConfig(env: Env): KiConfigResult {
  if (env[KI_ENV.enabled] !== 'true') return { ok: false, code: 'DISABLED' };
  const key = (env[KI_ENV.apiKey] ?? '').trim();
  if (key.length === 0) return { ok: false, code: 'NO_KEY' };
  // a key with a line break or a space cannot be a bearer token (header injection)
  if (/[\s\u0000-\u001f\u007f]/.test(key)) return { ok: false, code: 'NO_KEY' };
  const allowedHosts = allowedHostsOf(env);
  if (!allowedHosts) return { ok: false, code: 'BAD_HOSTS' };
  const policy: KiPolicy = { requireHttps: true, allowedHosts };
  const parsed = parseTarget(
    env[KI_ENV.baseUrl]?.trim() || SOKRATES_DEFAULT_BASE_URL,
    policy
  );
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    config: {
      target: parsed.target,
      policy,
      apiKey: key,
      model: modelOf(env[KI_ENV.model]),
      reasoningEffort: reasoningEffortOf(env[KI_ENV.reasoningEffort]),
      limits: {
        ...DEFAULT_LIMITS,
        timeoutMs: intOf(
          env[KI_ENV.timeoutMs],
          DEFAULT_LIMITS.timeoutMs,
          1000,
          MAX_TIMEOUT_MS
        ),
        maxCallsPerRun: intOf(
          env[KI_ENV.maxCallsPerRun],
          DEFAULT_LIMITS.maxCallsPerRun,
          0,
          5000
        ),
        maxCallsPerDay: intOf(
          env[KI_ENV.maxCallsPerDay],
          DEFAULT_LIMITS.maxCallsPerDay,
          0,
          20_000
        ),
      },
    },
  };
}
