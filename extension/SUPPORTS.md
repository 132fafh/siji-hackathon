# 思迹跨 AI 站点支持与适配说明

## 支持范围

思迹插件由“站点适配器＋通用编辑器识别＋手动启用未知站点”组成。它不是对所有网页的无差别分析器，也不承诺所有 AI 产品的内部页面、Shadow DOM、跨域 iframe 或频繁变化的 DOM 都能立即兼容。

| 站点 | 默认识别 | 输入适配 |
| --- | --- | --- |
| Kimi | `kimi.com`、`www.kimi.com` | 专用选择器＋通用回退 |
| ChatGPT | `chat.openai.com`、`chatgpt.com` | `#prompt-textarea`＋通用回退 |
| Claude | `claude.ai` | contenteditable／textarea |
| Gemini | `gemini.google.com` | `.ql-editor`＋通用回退 |
| DeepSeek | `chat.deepseek.com` | textarea／contenteditable |
| 豆包 | `doubao.com`、`www.doubao.com` | textarea／contenteditable |
| 通义千问 | `qianwen.com`、`tongyi.aliyun.com` | textarea／contenteditable |
| 腾讯元宝 | `yuanbao.tencent.com` | textarea／contenteditable |
| 智谱清言 | `chat.zhipu.cn`、`chatglm.cn` | textarea／contenteditable |
| Poe | `poe.com` | textarea／contenteditable |
| Perplexity | `perplexity.ai`、`www.perplexity.ai` | textarea／contenteditable |
| Microsoft Copilot | `copilot.microsoft.com` | textarea／contenteditable |
| Mistral Le Chat | `chat.mistral.ai` | textarea／contenteditable |
| Grok | `grok.com`、`x.ai` | textarea／contenteditable |
| 本地模拟页 | `localhost`、`127.0.0.1` | `#prompt-input`＋通用回退 |

域名按主机名及其子域名匹配，`kimi.com.evil.example` 这类相似后缀不会被误识别。

## 未识别站点怎样启用

1. 打开目标 AI 对话网页。
2. 点击浏览器工具栏里的思迹图标。
3. 阅读当前站点、启用状态和隐私说明。
4. 点击「在此站点启用思迹」。只有此后才开始本地行为分析。
5. 再点一次可停用。主流站点和手动启用站点分别记录在 `sijiDisabledHosts` 与 `sijiEnabledHosts`。

停用后不会继续生成提醒。刷新页面不会自动把未识别站点加入白名单之外的名单。

## 通用输入识别

`shared/site-adapters.js` 提供适配器，`content/detector.js` 负责实际行为采集。通用回退包括：

- `textarea`；
- 文本和搜索 `input`；
- `contenteditable=true` 与 `plaintext-only`；
- `role="textbox"`。

可见性、禁用、只读、密码框和嵌套重复消息会被过滤。输入采集使用事件委托，SPA 替换编辑器后由 `MutationObserver` 重新发现候选输入框。

## 权限与数据边界

- manifest 声明 `<all_urls>`，用于覆盖未知 AI 站点；**注入不等于开始分析**。未识别站点只有用户手动启用后才进入检测流程。
- 不读取 Cookie、账号密码或浏览历史，不申请 Cookie 权限。
- `keydown` 只判断是否按下 Backspace，不记录其他按键值或按键序列。
- 草稿与近期消息只在页面内存中处理。用户主动点击批准后，才写入 `chrome.storage.local.sijiHandoff` 并打开思迹接收页。
- 原文不拼入 URL，不默认上传远程服务器。
- 真实 AI 调用只在服务端配置后进行，密钥不得写进 manifest、content script、popup 或前端页面。
- Shadow DOM、跨域 iframe、浏览器受保护页面和复杂自定义编辑器可能需要单独适配。角色推断可能误判，近期消息只作辅助上下文，不覆盖原始表达。

## 新增站点适配器

在 `shared/site-adapters.js` 的 `BUILT_IN_SITES` 中添加：

```js
{
  id: 'example-ai',
  name: 'Example AI',
  hosts: ['example.ai'],
  editorSelectors: ['.example-editor', '[contenteditable]', 'textarea']
}
```

优先使用稳定的语义属性、可访问角色和表单结构，不要只绑定经常变化的样式类。修改后用以下测试验证：

```bash
node extension/test/site-adapters.test.js
node --test extension/test/background-sites.test.js
node extension/test/trigger-engine.test.js
```

## 可运行证明边界

当前完成的是跨站点适配框架、内置适配器、手动启用控制和测试桩。它不是“所有 AI 已实测通过”的清单。每个站点仍需验证：

1. 草稿是否被正确读取；
2. 用户消息角色是否误判；
3. 停顿后是否出现批准框；
4. 批准后原文是否进入思迹且不被覆盖；
5. 页面更新或编辑器替换后是否仍能恢复。

`SUPPORTS.md` 记录支持范围，不替代这些实测。
