# 思迹后端服务

仅使用 Node 内置模块，无 npm 依赖。**未配置 `SIJI_API_KEY` 时，所有生成接口仍使用明确标注的规则演示模式。**

## 启动与扩展联调

在项目根目录运行：

```bash
node server/server.js
```

1. 打开 `http://localhost:8141/mock-kimi.html`。
2. 在 Chrome / Edge 的扩展管理页启用开发者模式，加载项目的 `extension/` 目录。
3. 在模拟页输入未发送草稿并停顿，等待扩展弹窗；可滚动长历史、继续输入或退格来测试检测行为。
4. 点击「进入思迹」。扩展将一次性载荷写入 `chrome.storage.local.sijiHandoff`，打开 `http://localhost:8141/#/plugin`，并向该页注入 `app/bridge/siji-bridge.js`。
5. 桥接脚本读取后立即删除载荷，按思迹现有数据结构直接写入 localStorage 并进入 `#/s/<id>`（扩展隔离环境不能访问页面的 `SJ` 对象）。草稿原文不写入 URL，也不默认上传服务器。近期用户消息只在会话的 `pluginContext` 中作为辅助上下文展示，不覆盖 `original`。
6. 若没有待接收草稿，接收页会进入 `#/new` 并显示轻提示。重复注入由页面状态锁拦截，避免重复创建。

`app/index.html` 不直接引用桥接脚本；普通浏览器打开思迹不需要 `chrome` API。

## 真实 AI 配置（可选）

`server/ai-service.js` 封装 OpenAI 兼容的 `POST /chat/completions`，由后端读取以下环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SIJI_API_BASE` | OpenAI 兼容服务的基础 URL | `https://api.openai.com/v1` |
| `SIJI_API_KEY` | 服务端 API 密钥；不设置则保持 demo | 无 |
| `SIJI_MODEL` | 模型名称 | `gpt-4o-mini` |
| `SIJI_TIMEOUT_MS` | 每次模型请求的超时时间（毫秒） | `15000` |

Bash 示例（请在本机环境中填写自己的密钥，不要写入项目文件）：

```bash
export SIJI_API_BASE="https://api.openai.com/v1"
export SIJI_API_KEY="在本机环境填写"
export SIJI_MODEL="gpt-4o-mini"
export SIJI_TIMEOUT_MS="15000"
node server/server.js
```

Windows PowerShell 可使用 `$env:SIJI_API_KEY="在本机环境填写"`，其余变量同理。密钥只用于后端请求头，不会写入前端、扩展、响应或日志。

配置后，`restate / hints / expand / recall / answer` 会尝试真实模型；网络错误、上游 HTTP 错误、超时、无效 JSON 或不符合结构的结果会自动回退 demo。每个生成响应都有：

```json
{
  "meta": {
    "actualMode": "api",
    "fallback": false,
    "reason": null
  }
}
```

回退时 `actualMode` 为 `demo`、`fallback` 为 `true`，`reason` 只含安全错误代码与简要原因。顶层 `demo` 和 `mode` 字段保留用于兼容。

**隐私变化**：只有主动配置真实 API 后，对应请求所需的草稿、问题或用户消息才会发送给所配置的模型服务商；未配置时不会进行真实模型请求。请勿在前端或扩展中保存密钥。

## HTTP 接口

- `GET /api/health`：健康状态。
- `POST /api/restate`：输入 `{ "draft": "..." }`，返回 `restatement`。
- `POST /api/hints`：输入 `{ "draft": "...", "offset": 0 }`，返回三个 `hints`。
- `POST /api/expand`：输入 `{ "node": { "text": "...", "kind": "idea", "sourceQuote": "可选原话" }, "action": "alternatives", "count": 2, "preferences": {}, "exploration": 0.35, "existingCandidates": [{ "text": "已有候选", "sourceOrigin": "ai", "status": "candidate" }], "context": { "original": "可选原始表达" } }`，返回可接受、修改或拒绝的 `candidates`。动作支持 `project / decompose / alternatives / trace / challenge`，节点类型与动作权限由服务端再次校验。`exploration` 参与 MMR 选路；已有候选用于全图去重，`skippedDuplicates` 记录被跳过内容，池耗尽时不重复生成。`count` 是思维拓展量 B，支持 0–3；为 0 时暂停并直接返回，不调用真实模型。真实模型调用会发送当前节点、必要原话、已有候选文字及本次偏好。
- `POST /api/recall`：输入 `{ "draft": "...", "userMessages": [{ "id": "user-1", "text": "用户原话", "timestamp": 0 }] }`。
- `POST /api/answer`：输入 `{ "draft": "...", "question": "可选的当前问题" }`，返回 `facts / assumptions / missing / next` 四段。

POST 请求须使用 `Content-Type: application/json`，顶层为对象，请求体不超过 64 KiB。错误格式为：

```json
{ "error": { "code": "INVALID_DRAFT", "message": "字段 draft 必须是非空字符串。" } }
```

API 为 localhost 和回环地址来源设置 CORS 允许头。静态服务仅暴露 `app/`，拒绝目录穿越；`/mock-kimi.html` 是单独的扩展测试页。

## recall 演示评分

`recall` 优先检索 `userMessages`，对草稿和每条用户原话提取中文二字片段与英文词，计算 Dice 重叠并换算为 0–100：

```text
2 × 共同词片段数 ÷（草稿词片段数 + 原话词片段数）× 100
```

返回 `evidence: [{ id, text, score }]`，其中 `text` 保留原消息全文；`cues` 只引用证据，`aiAdditions` 单独列出规则或真实模型生成的推测，`uncertainty` 说明局限。无论是否配置真实模型，证据、消息 ID、原文和分数都由本地检索确定，模型返回的 `evidence` 不会被采用。没有有效重叠时，这三项均为空，不编造回忆。

**该分数只是可解释的词语重叠演示分，不是经过验证的真实遗忘概率，也不能证明语义或因果关系。真实模型输出同样可能出错，不宣称高精度。**

## 测试

```bash
node server/test-api.js
node server/test-ai-service.js
node app/test/run-tests.js
node --test tests/cloud-deployment.test.js
```

`test-api.js` 在实际监听的本地 HTTP 服务上使用 `fetch` 测试健康检查、静态页、全部 API、CORS、错误输入、请求体限制、中文路径和目录穿越，结束后关闭服务。

`test-ai-service.js` 使用动态端口启动本地 mock OpenAI 与思迹服务，验证五个 API 成功路径、扩展候选来源、recall 证据保护、HTTP 错误回退、JSON 容错、坏 JSON 回退和超时回退；不访问真实外网，也不使用真实密钥。


## 云端部署

`server/api-core.js` 是本地 Node 与云端共用的 API 逻辑；`server/api-fetch.js` 提供标准 Web `Request → Response` 适配。未设置 `SIJI_API_KEY` 时仍是明确标注的本地规则演示，不需要模型额度。真实密钥只能填写在托管平台的服务端环境变量中。

### Cloudflare Pages

1. 在 Workers & Pages 创建应用，选择 Pages 并连接 `132fafh/siji-hackathon`；
2. 构建命令填写 `node --version`，构建输出目录填写 `app`，不选择框架预设；
3. `functions/api/[[path]].js` 提供五个演示 API 与健康检查，静态 `app/mock-kimi.html` 与插件模拟页保持同步；
4. 部署后依次检查 `/api/health`、`/?v=boundary#/demo/delidata`、`/project-brief.html` 和 `/watch-demo.html`；
5. 默认不配置密钥。需要真实模型时，才在 Pages 的服务端设置中添加 `SIJI_API_BASE / SIJI_API_KEY / SIJI_MODEL / SIJI_TIMEOUT_MS`。

### Vercel 备用

根目录的 `vercel.json` 已设置 `app` 为静态输出目录，`api/[...path].js` 复用同一个 Node 服务处理 API 和插件模拟页。导入仓库后不需要安装依赖，也不需要填写模型密钥。

### Render 备用

根目录的 `render.yaml` 可用于 Blueprint：Node 免费计划、`node --version` 构建、`node server/server.js` 启动，健康检查为 `/api/health`。`HOST=0.0.0.0` 和 Render 分配的 `PORT` 已配置。免费实例可能休眠，正式演示前应提前打开健康检查。
