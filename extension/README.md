# 思迹 Chrome / Edge MV3 插件

在 Kimi 页面和本地 mock 页面上，根据本地行为与对话上下文计算 **上下文融合演示评分（0–100）**，显示 GitHub 风格的小型批准框，并在用户主动点击「批准」后进入思迹交接草稿。弹窗不是大型仪表盘，也不会替换思迹光影页。

> 该评分只用于黑客松演示和可解释规则验证。它不是经过验证的真实遗忘概率，不读心，不代表模型能力，也不应被理解为医疗、心理或高精度预测结果。

## 加载方式

无需安装 npm 依赖，也无需构建。

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本目录：`D:\Kimi\siji-hackathon\extension\`。
5. 若目录已加载过，修改代码后在扩展卡片上点击「重新加载」。

### Microsoft Edge

1. 打开 `edge://extensions/`。
2. 开启「开发人员模式」。
3. 点击「加载解压缩的扩展」。
4. 选择同一 `extension\` 目录。

扩展会在页面中加载适配器，但只有内置 AI 站点或用户手动启用的站点才进入检测流程。当前内置 Kimi、ChatGPT、Claude、Gemini、DeepSeek、豆包、通义千问、腾讯元宝、智谱清言、Poe、Perplexity、Microsoft Copilot、Mistral Le Chat、Grok 和本地模拟页。

点击工具栏里的思迹图标，可以查看当前站点、启用或停用检测。未识别站点必须手动启用，不会在打开任意网页时直接分析。支持范围、权限、Shadow DOM／iframe 限制和新增适配器方式见 **[SUPPORTS.md](./SUPPORTS.md)**。比赛交付材料见项目根目录的 **[SUBMISSION.md](../SUBMISSION.md)**。

## 本地演示

在项目根目录启动约定服务：

```bash
node server/server.js
```

然后执行以下流程：

1. 打开 `http://localhost:8141/mock-kimi.html`。
2. 聚焦输入框并输入草稿。
3. 停止输入约 10 秒。默认标准演示模式下，停顿项会使评分从 100 逐步降至 58，达到默认阈值后显示小型批准框。
4. 默认只显示简短标题、一句说明、小分数、「详情」、「批准」和「不用，我还好」。展开「详情」才会显示评分原因、SVG 曲线、阈值、灵敏度和「本次别提醒」。
5. 点击「批准」继续原有进入思迹流程。后台先写入 `chrome.storage.local.sijiHandoff`，成功后打开 `http://localhost:8141/#/plugin`。
6. 按项目架构，思迹页的 bridge 读取并立即删除一次性载荷，再创建工作区。

批准框桌面宽约 312px；移动端宽为 92vw 且不超过 340px，最大高度为 80vh，仅详情等内容超出时才滚动。按钮和关闭控件的最小触控高度为 44px，并保留 Esc、焦点圈定与归还。它是页面上的小型授权卡，不是全屏弹窗或大型仪表盘。

如果草稿为空，后台依次尝试当前页面选中文本、最近一条用户消息。三者都没有时不会打开新页面，而是在当前弹窗提示用户先输入或选择内容。

## 评分规则与边界

分数从 100 开始，按命中的透明规则扣分；**分数越低，越建议整理上下文**。当 `score <= threshold` 且不在冷却期时提醒，默认阈值为 60。

| 特征 | 默认标准模式规则 |
| --- | --- |
| 停顿 | 1.5 秒起计；演示模式按 10 秒对应 42 分、封顶 42 分。非演示模式按 30 秒对应 32 分、封顶 32 分 |
| 退格率 | 超过 0.12 的部分按比例扣分，封顶 12 分；只统计退格和输入事件数量 |
| 重写 | 检测到大幅缩短或替换草稿，每次 4 分，封顶 12 分 |
| 回读 | 检测到向上滚动历史，每次 3 分，封顶 10 分 |
| 未完成句 | 至少 4 个字符且没有句末标点，扣 9 分 |
| 长回答后未续写 | 最近助手消息至少 400 字、当前草稿为空且已停顿，扣 14 分 |
| 未解决指代 | 少于 100 字的草稿包含“这个／上述／that”等指代表达，扣 8 分 |
| 当前草稿长度 | 超过 240 字后每 60 字扣 1 分，封顶 10 分 |

灵敏度会乘到各项扣分上：少打扰 `0.75`、标准 `1`、较灵敏 `1.25`，在「详情」内通过滑块调整，不显示模式切换。阈值可在 0–100 之间设置。连续弹窗默认冷却 90 秒；「本次别提醒」会在当前页面不再主动提醒，刷新后恢复。

这些阈值和文本特征都是演示启发式规则。例如，没有句末标点不等于思路中断，向上滚动也可能只是正常阅读，长草稿本身也不表示遗忘。消息角色识别失败、输入法组合事件、复杂富文本和自定义滚动容器都可能影响结果。不应据此评价用户状态或能力。

## Kimi 选择器适配

实现位于 `content/detector.js`，不依赖某个固定 Kimi class 名称：

- 输入框同时查找 `textarea`、文本/搜索 `input`、`contenteditable` 和 `role="textbox"`。
- 所有行为通过 `focusin`、`input`、`keydown`、`pointerdown`、`scroll` 等事件委托采集，动态插入的编辑器无需重新绑定。
- `MutationObserver` 监听 SPA 对话和编辑器替换；编辑器被移除后会重新发现候选输入框。
- 对话优先使用 `data-message-author-role`、`data-author-role`、`data-role`、`data-message-id`、`article` 等语义结构。
- `roleHint()` 只把 aria/data 属性和 class 中的 `user/assistant` 等词作为辅助线索。无语义角色时使用有限的顺序/长度回退推断，可能误判，因此近期用户消息只作为可选辅助上下文。
- 可见性、禁用、只读、密码框和嵌套重复消息会被过滤。

Kimi 更新 DOM 后，优先调整 `EDITOR_SELECTOR`、`MESSAGE_SELECTOR` 和 `roleHint()`，不要把评分逻辑绑到页面样式类上。若输入框是 Shadow DOM 或跨域 iframe，当前通用选择器无法穿透，需要针对该宿主增加适配。

## 数据交接协议

点击「批准」时，`background.js` 保存：

```json
{
  "sijiHandoff": {
    "draft": "当前未发送草稿、选中文本或最近用户消息",
    "userMessages": [
      { "id": "user-1", "text": "可选的近期用户原话", "timestamp": 0 }
    ],
    "sourceUrl": "来源页面 URL",
    "createdAt": 0
  }
}
```

原文不会拼入 URL。除上述 `sijiHandoff` 外，扩展仅在本地保存提醒设置和上次弹窗时间。思迹接收页负责读取并立即删除 `sijiHandoff`。

## 隐私边界

- 不申请 Cookie 权限，不读取或上传账号密码、Cookie。
- `keydown` 只判断是否按下 Backspace，不记录其他按键值或按键序列。
- 草稿和对话文本只保留在当前页面内存；只有用户点击「批准」才写入本地交接载荷。
- 不默认发送文本到远程服务器，代码中没有远程分析或遥测请求。
- 密码输入框被排除；仍建议仅在目标对话页和 mock 页使用本演示扩展。

## 文件与测试

- `shared/trigger-engine.js`：UMD 纯函数评分、阈值和冷却判断，可在 Node 中 `require`。
- `content/detector.js`：输入框发现、行为与上下文采集。
- `content/popup.js` / `content/popup.css`：模态框、SVG 曲线、设置和键盘/焦点处理。
- `background.js`：一次性载荷保存与思迹页打开。
- `test/trigger-engine.test.js`：Node 内置 `assert` 单元测试，不依赖 DOM。

运行：

```bash
node --check shared/trigger-engine.js
node --check content/detector.js
node --check content/popup.js
node --check background.js
node --check test/trigger-engine.test.js
node test/trigger-engine.test.js
```
