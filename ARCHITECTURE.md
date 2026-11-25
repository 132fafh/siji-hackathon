# 思迹黑客松完整项目：实现契约

## 目录

```text
siji-hackathon/
├── extension/          # Chrome / Edge MV3 插件
├── app/                # 思迹静态应用（复用 D:\Kimi\siji）
├── server/             # 无依赖 Node HTTP 服务与演示 API
├── research/           # 研究文档、案例与基线结果
├── tests/              # 集成测试
└── README.md
```

## 运行约定

- 服务端口：`8141`。
- 启动：`node server/server.js`，服务 `app/` 静态文件。
- 插件测试页：`http://localhost:8141/mock-kimi.html`，模拟 Kimi 输入与消息。
- 插件目标页：`https://www.kimi.com/*`、`https://kimi.com/*`。
- 思迹接收页：`http://localhost:8141/#/plugin`。

## 插件检测与弹窗

- 检测输出是**上下文融合演示评分（0–100）**，不是经过验证的真实遗忘概率。
- 行为特征：停顿、输入、退格、重写、回读、焦点。
- 上下文特征：草稿长度、未完成句、长回答后未续写、回读历史、未解决指代、对话阶段。
- 默认阈值 60，提供少打扰/标准/较灵敏、冷却和关闭。
- GitHub 风格居中弹窗，用户可查看评分原因和曲线；不宣称读心。
- 插件自身实现，不改思迹核心算法；
- `extension/shared/site-adapters.js` 提供主流 AI 适配器与通用输入框回退，未知站点由扩展按钮手动启用或停用；manifest 虽声明通用注入，未识别站点不会直接开始分析；
- `extension/popup.html` 显示当前站点、启用状态、公开演示入口与数据边界；后台分别保存内置站点停用名单和未知站点启用名单。

## 数据交接

用户点击「进入思迹」后：

1. `extension/background.js` 打开 `http://localhost:8141/#/plugin`。
2. 在 `chrome.storage.local.sijiHandoff` 保存一次性载荷：
   ```json
   {
     "draft": "当前未发送草稿",
     "userMessages": [{"id":"user-1","text":"可选的近期用户原话","timestamp":0}],
     "sourceUrl": "来源页面",
     "createdAt": 0
   }
   ```
3. `app/bridge/siji-bridge.js`（由扩展注入，不属于扩展目标域名白名单之外）读取并立即删除载荷。
4. 桥接脚本按思迹现有数据结构直接写入 localStorage（隔离环境不能访问页面的 `SJ` 对象），跳转对应工作区；若有近期用户消息，作为辅助上下文展示，不覆盖 original。
5. 不把原文写入 URL，不默认上传远程服务器。

## 星落、导图与扩展偏好

- `app/js/thought-segments.js` 用明确标注的本地规则截取完整短句，过滤主持、同意、礼貌用语和单独虚词；它不是大模型语义提取器。
- `app/js/thought-graph.js` 保存八类节点、来源、原话、关系、深度和候选状态。`sourceOrigin` 区分 human / ai / demo / public，`labelOrigin` 区分截取、翻译、AI 生成和用户修改。
- `app/js/public-delidata.js` 与 `app/demo-data/delidata-wason-constructive.json` 提供 `#/demo/delidata` 只读公开案例，原文来自论文 Table 12；不写入历史，扩展偏好仅保存在内存。
- `app/js/organic-layout.js` 使用确定性随机初始位置、节点斥力、连线弹力、边界约束和微弱漂移形成非网格网络；自动舒展只改变坐标，固定拖拽节点，长期运行限制速度与时间步长。
- `app/js/thought-map-view.js` 默认只渲染无框网络和角落退出点，不渲染顶部栏、关键词条、参量条或底部操作条；节点拖动、平移缩放保留，扩展、接受、拒绝、修改、原话和偏好均通过右键、长按或 Shift+F10 节点菜单按需打开。
- `app/js/preference-vector.js` 只保存当前会话的七个显式权重、风格、数量、边界扩张总率上限和最近 50 次反馈，用于候选排序与规模控制；可编辑、可重置，不包含人格标签或跨会话用户标识。
- `app/js/graph-keywords.js` 使用 TextRank、个性化 PageRank 和 MMR 计算全图关键词与节点中心性；`session.focusPreferences.exploration` 保存单一 λ 参数，同时影响关键词、焦点显示和扩展候选选路。当前路径完整显示，其他内容渐进弱化，只有候选可能离开可视区域时才平滑跟随视角。
- `app/js/graph-expansion-guard.js` 对全图及响应内候选做文字、数字、否定和字面相似度去重；真实 API 与 demo 均经过检查，重复候选不添加，候选池耗尽时明确提示。
- `app/js/graph-expansion.js` 在原界面扩展前统一执行图相关排序、MMR、偏好和重复拦截，并把 100%–500% 的总率上限换算为候选预算；待确认候选占额度，拒绝释放，达到上限时不调用模型。`app/js/organic-layout.js` 让新节点从父节点连续展开。
- `app/js/graph-growth.js` 与验证脚本仅供内部回归研究，指标不进入产品界面或用户导出，也不是心理测量。
- 主星空空白区域按住拖动才沿轨迹生成涡元，单击空白不生成；节点点击、节点拖拽与空白拖拽分别处理。
- `session.thoughtMaps`、`session.expansionPreferences` 与 `session.focusPreferences` 写入 localStorage；`session.original` 仍由 store 禁止覆盖。导出包含全部导图路径及来源状态。

## 后端

`server/server.js` 使用 Node 内置 `http`，无第三方依赖：

- 静态服务 `app/`；
- `GET /api/health`；
- `POST /api/restate`：接收 `{draft}`，返回演示复述，明确 demo；
- `POST /api/hints`：返回三个轻量提示；
- `POST /api/expand`：接收 `{node,action,count,preferences,context}`，返回 1–3 条可拒绝的导图候选；真实模型或演示来源由 `meta.actualMode` 标明；
- `POST /api/recall`：接收 `{draft,userMessages}`，优先返回有消息 ID 的原文证据和候选线索，AI 新增内容单独标注；
- `POST /api/answer`：返回事实/假设/缺失/验证方向四段。

没有密钥时全部使用明确标注的演示模式。真实 OpenAI 兼容配置可通过环境变量后续增加，不能在前端或扩展中写密钥。

## 测试

- 插件检测引擎纯函数单元测试；
- 后端 API 实际 HTTP 测试；
- 思迹原有 45 项测试保持通过；
- `tests/fixtures/delidata-wason-constructive.json` 是星落与会话结构的固定公开案例，`tests/delidata-starfall.test.js` 验证原文短句、方案分离、关系、分裂和证据检索；
- 完整文件语法检查；
- mock 页面用于手动验证“输入→停顿→弹窗→进入思迹”。

## 研究材料

从 `D:\Kimi\siji-research` 复制文档、案例和 baseline/out 结果；不包含 379MB 原始数据和 19MB 抽样数据，不修改原件。
