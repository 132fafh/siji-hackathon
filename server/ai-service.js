'use strict';

const DEFAULT_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = `你是「思迹」的提问澄清助手，不是诊断、读心或评分系统。
始终使用简短、温和、可纠正的中文措辞；理解用户时使用“我暂时理解为”“可能”“推测”，不得宣称知道用户真正的意思。
不诊断心理或疾病，不测量 IQ，不贴固定标签，不伪装用户原话或原意。事实、用户原话与 AI 推测必须分开。
只根据本次提供的文本工作，不补充未提供的个人经历或来源。recall 任务只能把提供的 userMessages 当作原文证据，不得虚构消息 ID 或引用；AI 新增问题只能放在 aiAdditions，并明确是推测。
expand 任务只提出可拒绝的候选路径，不冒充用户决定，不编造证据、经历或事实；偏好只用于当前候选排序，不建立人格画像。
只输出一个符合任务要求的 JSON 对象，不要输出 Markdown 代码围栏或额外解释。`;

const TASK_INSTRUCTIONS = {
  restate: '生成不超过 100 字的可纠正复述，格式：{"restatement":"我暂时理解为……这是推测，你可以纠正。"}',
  hints: '生成恰好三个低负担提示，每项只邀请一个小动作，格式：{"hints":[{"type":"短标题","text":"提示文字"}]}',
  expand: '根据当前节点、指定 action 和本次 preferences，生成 1–3 条不同的后续导图候选。每条不超过 120 字，格式：{"candidates":[{"text":"候选路径","kind":"concept|idea|question|evidence|premise|direction|conclusion|fragment","style":"concrete|abstract"}]}。不得把候选写成用户已经确认的想法。',
  recall: '服务器已经确定原文 evidence，不要生成 evidence、cues、score 或来源。最多提出三个仅基于已提供原文的推测性问题，格式：{"aiAdditions":["推测：……"]}。没有依据时返回空数组。',
  answer: '基于草稿和可选问题生成四段保守回答，格式：{"facts":["只含输入可支持的事实"],"assumptions":["明确标注推测"],"missing":["仍缺少的信息"],"next":["可验证的小步骤"]}。四段都必须至少一项。',
};

class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AIError';
    this.code = code;
  }
}

function positiveTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS;
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      return part && part.type === 'text' && typeof part.text === 'string' ? part.text : '';
    }).join('');
  }
  return '';
}

function parseJSONObject(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim();
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (error) {
      // Try the next tolerant representation; final failure uses a safe error.
    }
  }
  throw new AIError('AI_INVALID_JSON', '模型没有返回可解析的 JSON 对象。');
}

function requiredString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AIError('AI_INVALID_SCHEMA', `模型结果缺少有效的 ${label}。`);
  }
  const text = value.trim();
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text;
}

function stringArray(value, label, options) {
  if (!Array.isArray(value)) {
    throw new AIError('AI_INVALID_SCHEMA', `模型结果的 ${label} 必须是数组。`);
  }
  const opts = options || {};
  const items = value.map((item) => requiredString(item, label, opts.maxLength));
  if (items.length < (opts.min || 0)) {
    throw new AIError('AI_INVALID_SCHEMA', `模型结果的 ${label} 数量不足。`);
  }
  return items.slice(0, opts.max || items.length);
}

function normalizeResult(task, value) {
  if (task === 'restate') {
    return { restatement: requiredString(value.restatement || value.text, 'restatement', 100) };
  }
  if (task === 'hints') {
    if (!Array.isArray(value.hints) || value.hints.length < 3) {
      throw new AIError('AI_INVALID_SCHEMA', '模型必须返回至少三个 hints。');
    }
    const hints = value.hints.slice(0, 3).map((hint, index) => {
      if (!hint || typeof hint !== 'object' || Array.isArray(hint)) {
        throw new AIError('AI_INVALID_SCHEMA', '每个 hint 必须是对象。');
      }
      return {
        id: `api-h${index}`,
        demo: false,
        type: requiredString(hint.type, 'hint.type', 30),
        text: requiredString(hint.text, 'hint.text', 160),
      };
    });
    return { hints };
  }
  if (task === 'expand') {
    if (!Array.isArray(value.candidates) || !value.candidates.length) {
      throw new AIError('AI_INVALID_SCHEMA', '模型必须返回至少一条候选路径。');
    }
    const kinds = new Set(['concept', 'idea', 'question', 'evidence', 'premise', 'direction', 'conclusion', 'fragment']);
    return {
      candidates: value.candidates.slice(0, 3).map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new AIError('AI_INVALID_SCHEMA', '每条候选路径必须是对象。');
        }
        return {
          id: `api-e${index}`,
          demo: false,
          sourceOrigin: 'ai',
          text: requiredString(item.text, 'candidate.text', 120),
          kind: kinds.has(item.kind) ? item.kind : 'idea',
          style: item.style === 'abstract' ? 'abstract' : 'concrete',
        };
      }),
    };
  }
  if (task === 'recall') {
    const additions = value.aiAdditions === undefined ? [] : stringArray(value.aiAdditions, 'aiAdditions', { max: 3, maxLength: 160 });
    return {
      aiAdditions: additions.map((text) => text.includes('推测') ? text : `AI 推测（非原文）：${text}`),
    };
  }
  if (task === 'answer') {
    return {
      facts: stringArray(value.facts, 'facts', { min: 1, max: 6, maxLength: 300 }),
      assumptions: stringArray(value.assumptions, 'assumptions', { min: 1, max: 6, maxLength: 300 }),
      missing: stringArray(value.missing, 'missing', { min: 1, max: 6, maxLength: 300 }),
      next: stringArray(value.next, 'next', { min: 1, max: 6, maxLength: 300 }),
    };
  }
  throw new AIError('AI_UNKNOWN_TASK', '不支持的 AI 任务。');
}

function safeReason(error) {
  if (error instanceof AIError) return `${error.code}: ${error.message}`;
  return 'AI_UNKNOWN_ERROR: 真实 AI 调用失败，已使用演示模式。';
}

function createAIService(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : env.SIJI_API_KEY;
  const apiBase = String(opts.apiBase || env.SIJI_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const model = opts.model || env.SIJI_MODEL || DEFAULT_MODEL;
  const timeoutMs = positiveTimeout(opts.timeoutMs !== undefined ? opts.timeoutMs : env.SIJI_TIMEOUT_MS);
  const fetchImpl = opts.fetchImpl || global.fetch;

  async function generate(task, input) {
    if (!apiKey) throw new AIError('AI_NOT_CONFIGURED', '未配置真实 AI。');
    if (!TASK_INSTRUCTIONS[task]) throw new AIError('AI_UNKNOWN_TASK', '不支持的 AI 任务。');
    if (typeof fetchImpl !== 'function') throw new AIError('AI_FETCH_UNAVAILABLE', '当前 Node 环境不支持 fetch。');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify({ task, instruction: TASK_INSTRUCTIONS[task], input }) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new AIError('AI_HTTP_ERROR', `上游服务返回 HTTP ${response.status}。`);

      let outer;
      try {
        outer = await response.json();
      } catch (error) {
        throw new AIError('AI_INVALID_RESPONSE', '上游服务响应不是有效 JSON。');
      }
      const content = outer && outer.choices && outer.choices[0] && outer.choices[0].message
        ? textContent(outer.choices[0].message.content)
        : '';
      if (!content.trim()) throw new AIError('AI_INVALID_RESPONSE', '上游服务没有返回文本内容。');
      return normalizeResult(task, parseJSONObject(content));
    } catch (error) {
      if (timedOut) throw new AIError('AI_TIMEOUT', `真实 AI 请求超过 ${timeoutMs} ms。`);
      if (error instanceof AIError) throw error;
      throw new AIError('AI_NETWORK_ERROR', '无法连接真实 AI 服务。');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    isConfigured: () => typeof apiKey === 'string' && apiKey.trim().length > 0,
    generate,
    model,
    timeoutMs,
  };
}

module.exports = {
  AIError,
  SYSTEM_PROMPT,
  createAIService,
  parseJSONObject,
  normalizeResult,
  safeReason,
};
