# dsh-teamorouter

English | [中文](README.zh.md)

> Maintained by TeamoRouter: the author works at TeamoRouter, the service this plugin connects to.

TeamoRouter as a model provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). One key gives the DSH model picker Claude, GPT, Gemini, DeepSeek, Kimi, GLM, Qwen, Grok, MiniMax and the other chat models [TeamoRouter](https://teamorouter.com) serves.

- **Live model list.** The plugin reads `GET https://api.teamorouter.com/v1/models` with your key and keeps the picker in sync every 6 hours, so new models show up without a plugin update. Image and video generators are left out because DSH drives chat models only.
- **Uses DSH's own OpenAI-compatible route.** It writes one route, `teamorouter`, into the built-in `llm-pi-ai` adapter (`api: openai-completions`, `baseURL: https://api.teamorouter.com/v1`). Streaming, tools, images and retries are DSH's own code paths. Only `providers.teamorouter` is written; your other providers are not touched.
- **The key stays in DSH's credential store.** The route carries the reference name `TEAMOROUTER_API_KEY`, never the key itself.

## Pricing

Pay as you go — no subscription. Top up from $5 by card or USDT. Per-model prices are on [teamorouter.com/models](https://teamorouter.com/models).

## Install

```sh
dsh plugin --profile web add github:2867297362mjb-sketch/dsh-teamorouter
```

Restart `dsh web` (or let `dsh-hmr` reload the profile).

## Add your key

1. Create a key at [teamorouter.com/dashboard](https://teamorouter.com/dashboard) (starts with `sk-teamo-`).
2. Store it under the reference name `TEAMOROUTER_API_KEY`, either way:
   - **Settings → Models → TeamoRouter**, paste the key into the API key field; or
   - export it before launching: `export TEAMOROUTER_API_KEY=sk-teamo-...` then `dsh web`.

Until a key is stored, the picker shows a short starter list (Claude Sonnet 5.5, Claude Opus 5.5, GPT-6 Sol, DeepSeek V4 Pro, DeepSeek V4 Flash, Gemini 3.8 Flash) so the provider is visible; within a minute of storing the key the full list replaces it.

## Headless runs

The starter route ships in the plugin's bundle patch, so it exists from the first boot. Point the headless profile's default model at it in `$DSH_HOME/profiles/headless/cordis.patch.yml`:

```yaml
- id: agent-default-model
  config:
    provider: teamorouter
    model: claude-sonnet-5-5
```

then pass the key through the environment (the headless profile does not read the interactive credential store):

```sh
TEAMOROUTER_API_KEY=sk-teamo-... dsh --profile headless "summarize README.md"
```

The first run works on the starter models. Each run also saves TeamoRouter's full model list into the profile in the background, usually in time for the second run; from then on any model on the list can be used.

If the headless profile's own `cordis.patch.yml` already declares other `llm-pi-ai` providers, that list replaces the plugin's starter route (DSH patch layers replace rather than merge). Run one task on a model that already works in that profile, with `TEAMOROUTER_API_KEY` exported; the plugin adds `teamorouter` next to your providers during that run, and you can switch the default model afterwards. `dsh web` is not affected: the plugin adds the route while the server runs.

## Configuration

All fields are optional. Override them in your profile's `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://api.teamorouter.com/v1` | API base. |
| `apiKeyEnv` | `TEAMOROUTER_API_KEY` | Credential reference name the route resolves per request. |
| `routeKey` | `teamorouter` | Provider id shown in DSH. |
| `include` | all chat models | Only keep these ids. Exact ids, `prefix*` or `*suffix`. |
| `exclude` | none | Drop these ids. Same pattern rules. |

Models TeamoRouter's list does not size get a 200K context window and a 32K output cap; ids ending in `[1M]` get 1M context. Claude, GPT-5/6, Gemini, Grok 4, Kimi K3 and the larger Qwen and Doubao models are marked as accepting images.

## What it sends where

- `GET {baseURL}/models` with your key and the User-Agent `dsh-teamorouter/<version>`, every 6 hours. While no key is stored, the plugin only re-checks the local credential store once a minute and sends nothing.
- Your chat requests, sent by DSH's `llm-pi-ai` adapter to `{baseURL}/chat/completions` with the header `X-Client-Source: dsh-teamorouter`, so TeamoRouter can count usage that comes through this plugin. It carries no user data.

Nothing else. No telemetry.

## Uninstall

```sh
dsh plugin --profile web remove dsh-teamorouter
```

The `teamorouter` route stays in Settings → Models until you delete it there, so sessions that used it keep working.

## Development

```sh
npm test
```

## License

MIT
