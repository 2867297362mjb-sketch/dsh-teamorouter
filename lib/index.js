// @ts-check
/**
 * dsh-teamorouter — adds TeamoRouter (https://teamorouter.com) as a model
 * provider in DeepSeek Harness.
 *
 * What it does:
 *   1. Writes one provider route, `teamorouter`, into the built-in llm-pi-ai
 *      adapter (OpenAI-compatible Chat Completions at api.teamorouter.com/v1).
 *      Only `providers.teamorouter.*` is touched, through path-addressed
 *      settings ops, so the user's other providers stay as they are.
 *   2. Reads the live model list from TeamoRouter's `/v1/models` and keeps the
 *      route in sync (every 6 hours; every minute while no key is stored yet).
 *
 * The API key never enters the config file: the route carries only the
 * credential reference name (`TEAMOROUTER_API_KEY` by default), which DSH
 * resolves per request from its credential store or the environment.
 *
 * Design constraints:
 *   - No imports from @deepseek-ai/* runtime packages; only services injected
 *     by cordis are used, so a host upgrade cannot break loading.
 *   - Network failures never throw out of the plugin; they are logged and
 *     retried, so DSH keeps booting when TeamoRouter is unreachable.
 */

import {
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_PROVIDER_ENTRY,
  DEFAULT_ROUTE_KEY,
  STARTER_MODELS,
  buildProfiles,
  buildRoute,
  normalizeBaseUrl,
  sameRoute,
} from './catalog.js'

export * from './catalog.js'

/** Plugin name; matches `name` in cordis.patch.yml. */
export const name = 'dsh-teamorouter'

const SYNC_MS = 6 * 60 * 60 * 1000
const WAITING_FOR_KEY_MS = 60 * 1000
const FIRST_SYNC_BOUND_MS = 8 * 1000
const ENTRY_WAIT_MS = 6 * 1000
const USER_AGENT = 'dsh-teamorouter/0.1.0 (+https://teamorouter.com)'
const FAILURE_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000]
/** Context and output fallbacks for models the catalog does not size. */
const DEFAULT_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_TOKENS = 32_000

/**
 * @typedef {object} TeamoRouterConfig
 * @property {string} [baseURL] - API base, default https://api.teamorouter.com/v1.
 * @property {string} [apiKeyEnv] - credential reference name, default TEAMOROUTER_API_KEY.
 * @property {string} [routeKey] - provider route id, default `teamorouter`.
 * @property {string} [providerEntry] - llm-pi-ai profile entry id, default `llm-pi-ai`.
 * @property {string[]} [include] - only keep these model ids (`prefix*` or `*suffix` allowed).
 * @property {string[]} [exclude] - drop these model ids (`prefix*` or `*suffix` allowed).
 */

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {TeamoRouterConfig} [config] - plugin config from cordis.patch.yml.
 */
export function apply(ctx, config = {}) {
  const options = {
    baseURL: normalizeBaseUrl(config.baseURL) || DEFAULT_BASE_URL,
    apiKeyEnv: typeof config.apiKeyEnv === 'string' && config.apiKeyEnv !== '' ? config.apiKeyEnv : DEFAULT_API_KEY_ENV,
    routeKey: typeof config.routeKey === 'string' && config.routeKey !== '' ? config.routeKey : DEFAULT_ROUTE_KEY,
    providerEntry: typeof config.providerEntry === 'string' && config.providerEntry !== '' ? config.providerEntry : DEFAULT_PROVIDER_ENTRY,
    filter: { include: config.include, exclude: config.exclude },
  }
  /** @type {{info?: (m: string) => void, warn?: (m: string) => void}} */
  const log = /** @type {any} */ (ctx).logger ?? console

  /** @type {(value?: unknown) => void} */
  let firstSyncDone = () => {}
  const firstSync = new Promise((resolve) => { firstSyncDone = resolve })

  // The settings service mounts after plugins from later bundles start, so
  // wait for it instead of reading it at apply time.
  ctx.inject(['settings'], (child) => {
    child.effect(() => {
      let timer
      let stopped = false
      let failures = 0
      const tick = async () => {
        if (stopped) return
        let wait = SYNC_MS
        try {
          const result = await syncOnce(child, options)
          failures = 0
          if (result.keyless) wait = WAITING_FOR_KEY_MS
          if (result.written) log.info?.(`teamorouter: wrote ${result.count} models to provider route "${options.routeKey}"`)
        } catch (error) {
          wait = FAILURE_BACKOFF_MS[Math.min(failures, FAILURE_BACKOFF_MS.length - 1)]
          failures += 1
          log.warn?.(`teamorouter: model sync failed (${errorText(error)}); retrying in ${Math.round(wait / 1000)}s`)
        }
        firstSyncDone()
        if (stopped) return
        timer = setTimeout(() => void tick(), wait)
        timer.unref?.()
      }
      void tick()
      return () => {
        stopped = true
        clearTimeout(timer)
      }
    }, 'teamorouter: model sync')
  })

  // Hold plugin start until the first sync lands (bounded), so a one-shot
  // `dsh --profile headless` run already sees the route. Offline, boot
  // continues after the bound and the loop keeps retrying in the background.
  return Promise.race([firstSync, new Promise((resolve) => setTimeout(resolve, FIRST_SYNC_BOUND_MS).unref?.())])
}

/**
 * Fetch the model list (or use the starter list when no key is stored yet)
 * and write the provider route when it changed.
 * @param {any} ctx - plugin context.
 * @param {{baseURL: string, apiKeyEnv: string, routeKey: string, providerEntry: string, filter: {include?: string[], exclude?: string[]}}} options - resolved options.
 * @returns {Promise<{count: number, written: boolean, keyless: boolean}>} outcome.
 */
export async function syncOnce(ctx, options) {
  const key = await readKey(ctx, options.apiKeyEnv)
  // Seed the starter route first, with no network call, when the profile's own
  // layer has none: a profile that declares other llm-pi-ai providers replaces
  // the bundle's starter route, and a short one-shot run may end before the
  // /models round trip below finishes.
  const starter = buildProfiles(STARTER_MODELS, options.filter)
  const seeded = await writeRoute(ctx, options, starter, { onlyIfMissing: true })
  let models
  if (key === '') {
    models = starter
  } else {
    const response = await fetch(`${options.baseURL}/models`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 401 || response.status === 403) {
      throw new Error(`TeamoRouter rejected the key stored as ${options.apiKeyEnv} (HTTP ${response.status}); create a new one at https://teamorouter.com/dashboard`)
    }
    if (!response.ok) throw new Error(`GET /models answered HTTP ${response.status}`)
    models = buildProfiles(await response.json(), options.filter)
    if (models.length === 0) throw new Error('GET /models returned no chat models')
  }
  // Without a key, stop at the seed: never shrink a route a keyed sync already filled.
  const written = key === '' ? seeded : await writeRoute(ctx, options, models)
  return { count: models.length, written: seeded || written, keyless: key === '' }
}

/**
 * Write `providers.<routeKey>` on the llm-pi-ai entry, field by field.
 * @param {any} ctx - plugin context.
 * @param {{baseURL: string, apiKeyEnv: string, routeKey: string, providerEntry: string}} options - resolved options.
 * @param {Array<object>} models - model profiles.
 * @param {{onlyIfMissing?: boolean}} [mode] - skip when the route already exists.
 * @returns {Promise<boolean>} whether anything was written.
 */
async function writeRoute(ctx, options, models, mode = {}) {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('settings service is not available in this profile')
  // llm-pi-ai can activate a moment after this plugin; give it a few seconds.
  let descriptor
  for (const deadline = Date.now() + ENTRY_WAIT_MS; ;) {
    descriptor = settings.describe().find((/** @type {any} */ row) => row.ns === options.providerEntry)
    if (descriptor !== undefined || Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (descriptor === undefined) throw new Error(`profile entry "${options.providerEntry}" not found (is llm-pi-ai enabled?)`)
  const target = {
    ...buildRoute(options.baseURL, options.apiKeyEnv, models),
    defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
    defaultMaxTokens: DEFAULT_MAX_TOKENS,
  }
  // Compare against the raw user layer: the resolved `value` carries schema
  // defaults and would never equal what we wrote.
  const current = (descriptor.user ?? descriptor.value)?.providers?.[options.routeKey]
  if (mode.onlyIfMissing && current !== undefined && current !== null) return false
  if (sameRoute(current, target)) return false
  const ops = Object.entries(target).map(([field, value]) => ({ op: 'set', path: ['providers', options.routeKey, field], value }))
  try {
    await settings.mutate(options.providerEntry, ops, descriptor.revision)
  } catch (error) {
    // Someone saved the Models page between describe and mutate: retry once on the fresh revision.
    if (!/revision|conflict|stale/i.test(errorText(error))) throw error
    const fresh = settings.describe().find((/** @type {any} */ row) => row.ns === options.providerEntry)
    if (fresh === undefined || fresh.revision === descriptor.revision) throw error
    await settings.mutate(options.providerEntry, ops, fresh.revision)
  }
  return true
}

/**
 * Resolve the API key: DSH credential store first, then the environment.
 * @param {any} ctx - plugin context.
 * @param {string} ref - credential reference name.
 * @returns {Promise<string>} the key, or '' when none is stored.
 */
async function readKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(ref)
      const value = typeof hit === 'string' ? hit : hit?.value
      if (typeof value === 'string' && value !== '') return value
    } catch {
      // Store still hydrating: fall back to the environment for this round.
    }
  }
  const ambient = process.env[ref]
  return typeof ambient === 'string' ? ambient.trim() : ''
}

/**
 * @param {unknown} error - anything thrown.
 * @returns {string} printable message (never contains the key).
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}
