import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProfiles, isChatModel, normalizeBaseUrl, sameRoute, buildRoute, STARTER_MODELS } from '../lib/catalog.js'

test('image and video generators are not offered as chat models', () => {
  for (const id of ['gpt-image-2', 'gpt-image-2.6-flare-4k-upscale', 'mj_imagine', 'gemini-3-pro-image', 'gemini-nano-banana-2.1', 'gemini-3.1-flash-image'])
    assert.equal(isChatModel(id), false, id)
  for (const id of ['claude-sonnet-5-5', 'gpt-6-sol', 'deepseek-v4-pro', 'kimi-k3[1M]', 'glm-5.3', 'gemini-3.8-flash'])
    assert.equal(isChatModel(id), true, id)
})

test('profiles: display name, image input, 1M context, de-dup, sorted', () => {
  const body = { data: [
    { id: 'kimi-k3[1M]', display_name: 'Kimi K3 1M' },
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
    { id: 'claude-opus-5-5', display_name: 'dup' },
    { id: 'glm-5.3' },
    { id: 'gpt-image-2' },
  ] }
  const out = buildProfiles(body)
  assert.deepEqual(out.map((m) => m.id), ['claude-opus-5-5', 'glm-5.3', 'kimi-k3[1M]'])
  assert.deepEqual(out[0].input, ['text', 'image'])
  assert.equal(out[1].name, 'glm-5.3')
  assert.equal(out[1].input, undefined)
  assert.equal(out[2].contextWindow, 1_000_000)
})

test('include / exclude filters accept prefix*', () => {
  const body = [{ id: 'claude-sonnet-5-5' }, { id: 'deepseek-v4-flash-free' }, { id: 'gpt-6-sol' }]
  assert.deepEqual(buildProfiles(body, { include: ['claude-*', 'deepseek-*'] }).map((m) => m.id), ['claude-sonnet-5-5', 'deepseek-v4-flash-free'])
  assert.deepEqual(buildProfiles(body, { exclude: ['*-free'] }).map((m) => m.id), ['claude-sonnet-5-5', 'gpt-6-sol'])
})

test('starter list is non-empty and all chat models', () => {
  assert.ok(buildProfiles(STARTER_MODELS).length === STARTER_MODELS.length)
})

test('base URL normalization and route equality', () => {
  assert.equal(normalizeBaseUrl('https://api.teamorouter.com/v1/'), 'https://api.teamorouter.com/v1')
  assert.equal(normalizeBaseUrl('not a url'), '')
  const route = buildRoute('https://api.teamorouter.com/v1', 'TEAMOROUTER_API_KEY', [{ id: 'a', name: 'a' }])
  assert.equal(sameRoute({ ...route, extra: 1 }, route), true)
  assert.equal(sameRoute({ ...route, models: [] }, route), false)
})
