/* 思迹 · AI 服务模块（可替换）
 *
 * 统一接口：restate / hints / draft / answer，全部为 async。
 * 两种模式（在设置页切换，见 #/settings）：
 *   - demo：本地规则生成（demo-ai.js），界面标注「演示模式」；
 *   - api ：OpenAI 兼容接口（chat/completions），端点/模型/密钥由用户在本地填写。
 *
 * 安全说明：MVP 为纯前端应用，API 密钥仅保存在用户本机浏览器的 localStorage，
 * 不会写入代码仓库。浏览器直连意味着密钥只发往用户自己填写的那个 API 端点，
 * 但任何网页直连第三方 API 都有端可见密钥的理论风险；生产环境应改为后端代理。
 */
(function () {
  const SJ = (window.SJ = window.SJ || {});

  const SYSTEM_PROMPT = `你是「思迹」，一个提问澄清与想法留痕工具中的 AI 助手。你的职责是帮助用户把自己模糊的想法说清楚，而不是替用户思考或给出长篇答案。

必须遵守以下行为准则：
1. 默认简短回应，不展示长篇推理；
2. 一次只提出一个关键问题，或提供三个可选提示；
3. 不诊断用户的心理状态；不测量或推测 IQ；不判断用户属于哪种固定思维类型；
4. 不声称理解人脑或能够读取真实想法；
5. 不补充用户没有表达过的经历或动机；
6. 不使用"你真正想问的是……"等确定性表达，一律使用"这可能是在问……""我暂时理解为……"等可纠正措辞；
7. 明确标注哪些内容是你的推测；
8. 不把 AI 生成的内容伪装成用户原意；
9. 不追求消除所有混乱，允许保留模糊、矛盾和未确定；
10. 用户可以在任何阶段否定、跳过、返回或离开，你必须尊重；
11. 个性化仅限于当前对话中的可观察反馈，不建立固定人格画像；
12. 回答使用简体中文，语气安静、克制、低刺激。

用户原始表达是不可变的，你只能引用，不能改写或覆盖。`;

  function mode() {
    const s = SJ.store.getSettings();
    if (s.mode === 'api' && s.baseUrl && s.apiKey) return 'api';
    return 'demo';
  }

  async function callAPI(messages, jsonMode) {
    const s = SJ.store.getSettings();
    const base = s.baseUrl.replace(/\/+$/, '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + s.apiKey,
        },
        body: JSON.stringify({
          model: s.model || 'gpt-4o-mini',
          messages: messages,
          temperature: 0.4,
          response_format: jsonMode ? { type: 'json_object' } : undefined,
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`API 请求失败（HTTP ${resp.status}）：${t.slice(0, 200)}`);
      }
      const data = await resp.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('API 返回内容为空');
      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  /* 从模型回复中宽松地解析 JSON */
  function parseJSON(text, fallback) {
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) return fallback;
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      return fallback;
    }
  }

  function transcript(session) {
    const lines = [`【用户原始表达】${session.original.text}`];
    session.rounds.forEach((r) => {
      if (r.restatement) lines.push(`【AI 复述（第${r.n}轮前）】${r.restatement}`);
      if (r.chosenHint) lines.push(`【用户选择的提示】${r.chosenHint.text}`);
      if (r.answer) lines.push(`【用户第${r.n}轮回答】${r.answer.text}`);
      if (r.draft) lines.push(`【暂定问题】${r.draft.text}`);
    });
    if (session.misunderstandings && session.misunderstandings.length) {
      session.misunderstandings.forEach((m) => lines.push(`【用户否定的 AI 理解】${m.text}`));
    }
    return lines.join('\n');
  }

  const api = {
    async restate(session) {
      const content = await callAPI([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `用户的原始表达：\n${session.original.text}\n\n请用不超过 100 字复述当前的困惑。要求：\n- 不直接给完整答案；\n- 不补充用户没表达过的经历或动机；\n- 用"这可能是在问……""我暂时理解为……"等可纠正措辞；\n- 明确标注哪些是你的推测。\n只输出复述本身。`,
        },
      ]);
      return content;
    },

    async hints(session, offset) {
      const content = await callAPI(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${transcript(session)}\n\n以上是用户到目前为止的全部表达（第 ${session.rounds.length + 1} 轮）。\n\n请生成恰好三张"提示卡"，每张只提供一个简单的思考动作（例如：留住一个词 / 回到具体经验 / 寻找一个关系 / 找一个反例 / 回到最初目标）。要求：\n- 每张卡是一个低负担的小动作，不要提问连环；\n- 结合用户实际用词，不引入新话题；\n- 以 JSON 输出：{"hints":[{"type":"提示类型","text":"提示内容"},...]}，text 不超过 60 字。`,
          },
        ],
        true
      );
      const parsed = parseJSON(content, { hints: [] });
      const hints = (parsed.hints || []).slice(0, 3).map((h, i) => ({
        id: 'h' + Date.now().toString(36) + i,
        type: SJ.util.clamp(h.type || '思考提示', 12),
        text: SJ.util.clamp(h.text || '', 80),
      }));
      if (hints.length < 3) throw new Error('API 返回的提示卡数量不足，请重试');
      return hints;
    },

    async draft(session) {
      const content = await callAPI(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${transcript(session)}\n\n请根据用户自己的回答，更新"当前暂定问题"。\n以 JSON 输出：{"userPart":"完全来自用户原话与回答的部分","aiPart":"你新增或推测的部分（必须明确这是推测）","text":"完整暂定问题，80 字以内"}\n要求：userPart 只能引用或轻度整理用户说过的内容；aiPart 必须可被用户否定；text 用可纠正语气。`,
          },
        ],
        true
      );
      const parsed = parseJSON(content, null);
      if (!parsed || !parsed.text) throw new Error('API 返回格式不正确');
      return {
        text: SJ.util.clamp(parsed.text, 120),
        userPart: SJ.util.clamp(parsed.userPart || '', 120),
        aiPart: SJ.util.clamp(parsed.aiPart || '', 120),
      };
    },

    async answer(session) {
      const content = await callAPI(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${transcript(session)}\n\n用户已确认问题：「${session.confirmed.text}」。\n\n请生成完整回答，以 JSON 输出：{"facts":["相对确定的事实（优先引用用户自己的话）"],"assumptions":["基于假设的解释（逐条标注是推测）"],"missing":["仍然缺少的信息"],"next":["用户可以继续验证的方向"]}\n要求：每项是一个数组，各 2-4 条；事实与推测严格区分；不诊断、不贴标签；允许保留未确定。`,
          },
        ],
        true
      );
      const parsed = parseJSON(content, null);
      if (!parsed || !Array.isArray(parsed.facts)) throw new Error('API 返回格式不正确');
      const clean = (arr) => (Array.isArray(arr) ? arr.map((x) => SJ.util.clamp(x, 200)).filter(Boolean).slice(0, 5) : []);
      return {
        facts: clean(parsed.facts),
        assumptions: clean(parsed.assumptions),
        missing: clean(parsed.missing),
        next: clean(parsed.next),
      };
    },
  };

  SJ.ai = {
    source: mode,
    /** API 未配置或调用失败时自动回退演示模式，保证流程不中断 */
    async restate(session) {
      if (mode() === 'api') {
        try {
          return await api.restate(session);
        } catch (e) {
          console.warn('[思迹] API 失败，回退演示模式:', e.message);
        }
      }
      return SJ.demoAI.restate(session);
    },
    async hints(session, offset) {
      if (mode() === 'api') {
        try {
          return await api.hints(session, offset);
        } catch (e) {
          console.warn('[思迹] API 失败，回退演示模式:', e.message);
        }
      }
      return SJ.demoAI.hints(session, offset);
    },
    async draft(session) {
      if (mode() === 'api') {
        try {
          return await api.draft(session);
        } catch (e) {
          console.warn('[思迹] API 失败，回退演示模式:', e.message);
        }
      }
      return SJ.demoAI.draft(session);
    },
    async answer(session) {
      if (mode() === 'api') {
        try {
          return await api.answer(session);
        } catch (e) {
          console.warn('[思迹] API 失败，回退演示模式:', e.message);
        }
      }
      return SJ.demoAI.answer(session);
    },
    /** API 模式原始调用失败信息（设置页"测试连接"用） */
    async testConnection() {
      const s = SJ.store.getSettings();
      if (!(s.mode === 'api' && s.baseUrl && s.apiKey)) {
        throw new Error('请先在设置页填写 API 端点与密钥');
      }
      const content = await callAPI([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: '请只回复：连接正常' },
      ]);
      return content;
    },
    SYSTEM_PROMPT: SYSTEM_PROMPT,
  };
})();
