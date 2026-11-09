import test from 'node:test'
import assert from 'node:assert/strict'
import { syncOnce } from '../lib/index.js'

const OPTIONS = {
  baseURL: 'https://api.teamorouter.com/v1',
  apiKeyEnv: 'TEAMOROUTER_API_KEY',
  routeKey: 'teamorouter',
  providerEntry: 'llm-pi-ai',
  filter: {},
}

/** Fake settings service holding one llm-pi-ai entry; records every mutate. */
function fakeCtx({ user = {}, key } = {}) {
  const state = { user: structuredClone(user), revision: 1, mutations: [] }
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision: state.revision, user: state.user, value: { ...state.user, defaulted: true } }],
    mutate: async (ns, ops, revision) => {
      assert.equal(ns, 'llm-pi-ai')
      assert.equal(revision, state.revision)
      for (const op of ops) {
        let node = state.user
        for (const part of op.path.slice(0, -1)) node = node[part] ??= {}
        node[op.path.at(-1)] = op.value
      }
      state.revision += 1
      state.mutations.push(ops)
    },
  }
  const credentials = { resolve: async (ref) => (ref === 'TEAMOROUTER_API_KEY' && key ? { value: key } : undefined) }
  return { state, ctx: { get: (name) => ({ settings, credentials })[name] } }
}

function mockFetch(t, body, status = 200) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, auth: init?.headers?.authorization })
    return new Response(JSON.stringify(body), { status })
  })
  return calls
}

test('keyless first boot seeds the starter list without any network call', async (t) => {
  const calls = mockFetch(t, { data: [] })
  const { ctx, state } = fakeCtx()
  const result = await syncOnce(ctx, OPTIONS)
  assert.equal(calls.length, 0)
  assert.equal(result.keyless, true)
  assert.equal(result.written, true)
  assert.equal(state.user.providers.teamorouter.models.length, 6)
  assert.equal(state.user.providers.teamorouter.apiKeyEnv, 'TEAMOROUTER_API_KEY')
  assert.deepEqual(state.user.providers.teamorouter.headers, { 'X-Client-Source': 'dsh-teamorouter' })
})

test('with a key: fetches /models with bearer auth, writes only providers.teamorouter.*, keeps other routes', async (t) => {
  const calls = mockFetch(t, { data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }, { id: 'gpt-image-2' }, { id: 'glm-5.3' }] })
  const { ctx, state } = fakeCtx({ user: { providers: { other: { api: 'openai-completions', baseURL: 'https://x/v1', models: [{ id: 'm' }] } } }, key: 'sk-teamo-test' })
  const result = await syncOnce(ctx, OPTIONS)
  assert.equal(calls[0].url, 'https://api.teamorouter.com/v1/models')
  assert.equal(calls[0].auth, 'Bearer sk-teamo-test')
  assert.deepEqual(state.user.providers.teamorouter.models.map((m) => m.id), ['claude-sonnet-5-5', 'glm-5.3'])
  assert.deepEqual(state.user.providers.other.models, [{ id: 'm' }])
  for (const ops of state.mutations) for (const op of ops) assert.deepEqual(op.path.slice(0, 2), ['providers', 'teamorouter'])
  assert.equal(result.written, true)
  assert.ok(!JSON.stringify(state.user).includes('sk-teamo-test'), 'key must never be written to settings')
})

test('an unchanged list is not rewritten', async (t) => {
  mockFetch(t, { data: [{ id: 'glm-5.3' }] })
  const { ctx, state } = fakeCtx({ key: 'sk-teamo-test' })
  await syncOnce(ctx, OPTIONS)
  const writes = state.mutations.length
  const again = await syncOnce(ctx, OPTIONS)
  assert.equal(again.written, false)
  assert.equal(state.mutations.length, writes)
})

test('a missing route is seeded before the network call, then replaced by the live list', async (t) => {
  let seededBeforeFetch = false
  const { ctx, state } = fakeCtx({ key: 'sk-teamo-test' })
  t.mock.method(globalThis, 'fetch', async () => {
    seededBeforeFetch = state.user.providers?.teamorouter?.models?.length === 6
    return new Response(JSON.stringify({ data: [{ id: 'glm-5.3' }] }), { status: 200 })
  })
  await syncOnce(ctx, OPTIONS)
  assert.equal(seededBeforeFetch, true)
  assert.deepEqual(state.user.providers.teamorouter.models.map((m) => m.id), ['glm-5.3'])
})

test('a keyless run never shrinks a list a keyed sync filled', async (t) => {
  mockFetch(t, { data: [{ id: 'glm-5.3' }, { id: 'kimi-k3' }, { id: 'qwen3.8-max' }, { id: 'grok-4.7' }, { id: 'mimo-v2.6-pro' }, { id: 'gpt-6-sol' }] })
  const keyed = fakeCtx({ key: 'sk-teamo-test' })
  await syncOnce(keyed.ctx, OPTIONS)
  const { ctx, state } = fakeCtx({ user: keyed.state.user })
  const result = await syncOnce(ctx, OPTIONS)
  assert.equal(result.written, false)
  assert.equal(state.user.providers.teamorouter.models.length, 6)
})

test('a rejected key surfaces a clear error and leaves only the starter route', async (t) => {
  mockFetch(t, { error: {} }, 401)
  const { ctx, state } = fakeCtx({ key: 'sk-teamo-bad' })
  await assert.rejects(syncOnce(ctx, OPTIONS), /rejected the key stored as TEAMOROUTER_API_KEY/)
  assert.equal(state.user.providers.teamorouter.models.length, 6)
  assert.ok(!JSON.stringify(state.user).includes('sk-teamo-bad'))
})
