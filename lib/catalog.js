// @ts-check
/**
 * Pure helpers: turn TeamoRouter's `/v1/models` answer into llm-pi-ai model
 * profiles, and build the provider route this plugin writes. No I/O here, so
 * everything is unit-testable.
 */

export const DEFAULT_BASE_URL = 'https://api.teamorouter.com/v1'
export const DEFAULT_API_KEY_ENV = 'TEAMOROUTER_API_KEY'
export const DEFAULT_ROUTE_KEY = 'teamorouter'
export const DEFAULT_PROVIDER_ENTRY = 'llm-pi-ai'
/** TeamoRouter's gateway records this header as the request's client, so usage from this plugin is countable. */
export const CLIENT_SOURCE = 'dsh-teamorouter'

/**
 * Models shown before a key is stored, so the provider is visible in
 * Settings → Models and the key can be pasted there. The full list replaces
 * this on the first successful sync. Keep in step with cordis.patch.yml.
 */
export const STARTER_MODELS = Object.freeze([
  { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
  { id: 'gpt-6-sol', display_name: 'GPT-6 Sol' },
  { id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro' },
  { id: 'deepseek-v4-flash', display_name: 'DeepSeek V4 Flash' },
  { id: 'gemini-3.8-flash', display_name: 'Gemini 3.8 Flash' },
])

/** Ids that are image / video generators, not chat models. */
const NON_CHAT = /(^|[-_.])(image|imagine|upscale|banana)([-_.]|$)|^mj_|-4k-upscale$/i

/** Families whose chat endpoints accept image input. */
const VISION = /^(claude-|gpt-5|gpt-6|gemini-|grok-4|kimi-k3|qwen3\.[78]-max|doubao-seed-2\.1-pro)/i

/**
 * Strip trailing slashes; keep the `/v1` the user gave.
 * @param {unknown} value - configured base URL.
 * @returns {string} normalized URL, or '' when unusable.
 */
export function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+/i.test(trimmed) ? trimmed : ''
}

/**
 * Whether a model id is a chat model DSH can drive.
 * @param {string} id - model id.
 * @returns {boolean} true for chat models.
 */
export function isChatModel(id) {
  return typeof id === 'string' && id.trim() !== '' && !NON_CHAT.test(id)
}

/**
 * One `/v1/models` row → one llm-pi-ai model profile.
 * @param {{id?: unknown, display_name?: unknown}} row - catalog row.
 * @returns {{id: string, name: string, input?: string[], contextWindow?: number} | undefined} profile.
 */
export function toProfile(row) {
  const id = typeof row?.id === 'string' ? row.id.trim() : ''
  if (!isChatModel(id)) return undefined
  const label = typeof row?.display_name === 'string' && row.display_name.trim() !== '' ? row.display_name.trim() : id
  /** @type {{id: string, name: string, input?: string[], contextWindow?: number}} */
  const profile = { id, name: label }
  if (VISION.test(id)) profile.input = ['text', 'image']
  if (/\[1M\]$/i.test(id)) profile.contextWindow = 1_000_000
  return profile
}

/**
 * `/v1/models` body → sorted, de-duplicated profiles.
 * @param {unknown} body - parsed JSON answer (`{data: [...]}` or a bare array).
 * @param {{include?: string[], exclude?: string[]}} [filter] - optional id filters (exact ids, `prefix*` or `*suffix`).
 * @returns {Array<{id: string, name: string}>} profiles.
 */
export function buildProfiles(body, filter = {}) {
  const rows = Array.isArray(body) ? body : Array.isArray(/** @type {any} */ (body)?.data) ? /** @type {any} */ (body).data : []
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const profile = toProfile(row)
    if (profile === undefined || seen.has(profile.id)) continue
    if (!passes(profile.id, filter)) continue
    seen.add(profile.id)
    out.push(profile)
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return out
}

/**
 * @param {string} id - model id.
 * @param {{include?: string[], exclude?: string[]}} filter - filters.
 * @returns {boolean} whether the id is kept.
 */
function passes(id, filter) {
  const match = (/** @type {string} */ pattern) => {
    if (pattern.endsWith('*')) return id.startsWith(pattern.slice(0, -1))
    if (pattern.startsWith('*')) return id.endsWith(pattern.slice(1))
    return id === pattern
  }
  const include = Array.isArray(filter.include) ? filter.include.filter((p) => typeof p === 'string' && p !== '') : []
  const exclude = Array.isArray(filter.exclude) ? filter.exclude.filter((p) => typeof p === 'string' && p !== '') : []
  if (include.length > 0 && !include.some(match)) return false
  return !exclude.some(match)
}

/**
 * The llm-pi-ai provider route this plugin owns.
 * @param {string} baseURL - normalized base URL ending in `/v1`.
 * @param {string} apiKeyEnv - credential reference name.
 * @param {Array<object>} models - model profiles.
 * @returns {Record<string, unknown>} route value.
 */
export function buildRoute(baseURL, apiKeyEnv, models) {
  return {
    displayName: 'TeamoRouter',
    api: 'openai-completions',
    baseURL,
    apiKeyEnv,
    headers: { 'X-Client-Source': CLIENT_SOURCE },
    models,
  }
}

/**
 * Whether the stored route already equals the target (skip a write when so).
 * @param {unknown} current - stored route.
 * @param {Record<string, unknown>} target - wanted route.
 * @returns {boolean} true when equal.
 */
export function sameRoute(current, target) {
  if (current === null || typeof current !== 'object') return false
  return Object.keys(target).every((key) => JSON.stringify(/** @type {any} */ (current)[key]) === JSON.stringify(target[key]))
}
