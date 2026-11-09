# dsh-teamorouter

[English](README.md) | 中文

> 由 TeamoRouter 维护：作者在 TeamoRouter（本插件连接的服务）工作。

把 TeamoRouter 接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）当模型提供商。一把 Key，DSH 的模型选择器里就有 [TeamoRouter](https://teamorouter.com) 上的 Claude、GPT、Gemini、DeepSeek、Kimi、GLM、Qwen、Grok、MiniMax 等对话模型。

- **模型列表实时同步。** 插件用你的 Key 读 `GET https://api.teamorouter.com/v1/models`，每 6 小时同步一次，上新模型不用等插件更新。生图、生视频模型不放进来，因为 DSH 只驱动对话模型。
- **走 DSH 自带的 OpenAI 兼容路由。** 插件只在内置的 `llm-pi-ai` 里写一条 `teamorouter` 路由（`api: openai-completions`，`baseURL: https://api.teamorouter.com/v1`），流式、工具调用、图片、重试都是 DSH 自己的代码。只写 `providers.teamorouter`，你别的提供商不动。
- **Key 只存在 DSH 的凭据库里。** 路由里只有引用名 `TEAMOROUTER_API_KEY`，不写 Key 本身。

## 价格

按量付费，没有订阅。$5 起充，支持银行卡和 USDT。各模型价格见 [teamorouter.com/models](https://teamorouter.com/models)。

## 安装

```sh
dsh plugin --profile web add github:2867297362mjb-sketch/dsh-teamorouter
```

重启 `dsh web`（或等 `dsh-hmr` 自动重载）。

## 填 Key

1. 在 [teamorouter.com/dashboard](https://teamorouter.com/dashboard) 创建 Key（`sk-teamo-` 开头）。
2. 用引用名 `TEAMOROUTER_API_KEY` 存起来，两种方式任选：
   - **设置 → 模型 → TeamoRouter**，把 Key 粘到 API Key 一栏；或者
   - 启动前导出：`export TEAMOROUTER_API_KEY=sk-teamo-...`，再 `dsh web`。

还没存 Key 时，选择器里先显示几个常用模型（Claude Sonnet 5.5、Claude Opus 5.5、GPT-6 Sol、DeepSeek V4 Pro、DeepSeek V4 Flash、Gemini 3.8 Flash），方便你找到这个提供商；存好 Key 后一分钟内换成完整列表。

## 无界面（headless）模式

起步路由写在插件自带的补丁里，第一次启动就有。在 `$DSH_HOME/profiles/headless/cordis.patch.yml` 里把默认模型指过来：

```yaml
- id: agent-default-model
  config:
    provider: teamorouter
    model: claude-sonnet-5-5
```

Key 用环境变量传（headless 不读交互式凭据库）：

```sh
TEAMOROUTER_API_KEY=sk-teamo-... dsh --profile headless "总结一下 README.md"
```

第一次运行用起步模型就能跑。每次运行还会在后台把 TeamoRouter 的完整模型列表存进 profile，一般第二次运行就能用上，之后列表里任意模型都可以选。

如果 headless profile 自己的 `cordis.patch.yml` 里已经配了别的 `llm-pi-ai` 提供商，DSH 的配置层是整段替换而不是合并，插件自带的起步路由会被盖掉。这时先用该 profile 里本来就能用的模型跑一次任务（同时导出 `TEAMOROUTER_API_KEY`），插件会在这次运行中把 `teamorouter` 加到你的提供商旁边，之后再切默认模型即可。`dsh web` 不受影响：服务运行期间插件会自己补上路由。

## 配置

全部可选，在 profile 的 `cordis.patch.yml` 里覆盖：

| 字段 | 默认 | 含义 |
|---|---|---|
| `baseURL` | `https://api.teamorouter.com/v1` | 接口地址 |
| `apiKeyEnv` | `TEAMOROUTER_API_KEY` | 每次请求时解析的凭据引用名 |
| `routeKey` | `teamorouter` | DSH 里显示的提供商 id |
| `include` | 全部对话模型 | 只保留这些 id。支持精确 id、`前缀*`、`*后缀` |
| `exclude` | 无 | 去掉这些 id，规则同上 |

TeamoRouter 列表里没写上下文的模型，按 200K 上下文、32K 输出上限处理；id 以 `[1M]` 结尾的按 1M 上下文。Claude、GPT-5/6、Gemini、Grok 4、Kimi K3 以及 Qwen、豆包的大模型标记为可收图片。

## 会发什么请求、发到哪

- 每 6 小时一次 `GET {baseURL}/models`，User-Agent 为 `dsh-teamorouter/<版本>`（没存 Key 时每分钟检查一次本地凭据，不发请求）。
- 你的对话请求，由 DSH 的 `llm-pi-ai` 发到 `{baseURL}/chat/completions`，带请求头 `X-Client-Source: dsh-teamorouter`，用来让 TeamoRouter 统计经这个插件来的用量，不含任何用户数据。

没有别的请求，不收集任何数据。

## 卸载

```sh
dsh plugin --profile web remove dsh-teamorouter
```

`teamorouter` 路由会留在 设置 → 模型 里，用过它的会话还能继续跑；不要了在那里删掉即可。

## 开发

```sh
npm test
```

## 许可

MIT
