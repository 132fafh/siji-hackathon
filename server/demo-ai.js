'use strict';

const STOPWORDS = [
  '不知道', '为什么', '是不是', '有没有', '能不能', '怎么样', '怎么办', '什么意思',
  '我觉得', '我感觉', '我认为', '我在想', '其实', '因为', '所以', '但是', '然后',
  '而且', '不过', '虽然', '如果', '或者', '以及', '并且', '一个', '这个', '那个',
  '什么', '怎么', '这样', '那样', '现在', '有点', '真的', '应该', '可能', '就是',
  '不是', '没有', '可以', '还是', '已经', '正在', '非常', '特别', '比较', '大概',
  '也许', '好像', '似乎', '总是', '经常', '有时', '关于', '对于', '自己', '我们',
  '你们', '他们', '等等', '一下', '一些', '的时候', '不确定', '想不通',
];

const STOP_TOKENS = new Set([
  '我们', '你们', '他们', '自己', '一个', '这个', '那个', '什么', '怎么', '这样',
  '那样', '现在', '有点', '真的', '应该', '可能', '就是', '不是', '没有', '可以',
  '还是', '已经', '正在', '非常', '特别', '比较', '大概', '也许', '好像', '似乎',
  '总是', '经常', '有时', '关于', '对于', '因为', '所以', '但是', '然后', '而且',
  '不过', '虽然', '如果', '或者', '以及', '并且', '觉得', '感觉', '认为', '知道',
  '时候', '地方', '东西', '一下', '一些', '的', '了', '和', '是', '在', '我', '你',
  '他', '她', '它', '就', '都', '也', '还', '与', '及', '被', '把', '让', '向',
  '从', '到', '对', '为', '之', '其', '这', '那', '有', '无', '不', '要', '会',
  '能', '可', '该', '各', '每', '吗', '呢', '吧', '啊', '呀', '哦', '嘛', '呗',
  '着', '过', '地', '得', '又', '再', '只', '最', '更', '但', '而', '且', '或',
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'are', 'was', 'were', 'have',
]);

function clamp(value, length) {
  const text = String(value || '');
  return text.length > length ? text.slice(0, length) : text;
}

function firstClause(text, length) {
  const clauses = String(text || '')
    .split(/[，。！？；、,.!?;：:\n\r\t\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return clamp(clauses[0] || String(text || '').trim(), length || 36);
}

function extractKeywords(text, count) {
  let work = String(text || '').toLowerCase();
  STOPWORDS.slice().sort((a, b) => b.length - a.length).forEach((word) => {
    work = work.split(word).join(' ');
  });
  const segments = work
    .split(/[^一-龥a-z0-9]+/)
    .filter((part) => part.length >= 2 && part.length <= 12);
  const scores = new Map();
  segments.forEach((part) => {
    scores.set(part, (scores.get(part) || 0) + 1 + Math.min(part.length, 6) * 0.15);
  });
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0])
    .slice(0, count || 3);
}

function restate(draft) {
  const clause = firstClause(draft, 32);
  const keywords = extractKeywords(draft, 2);
  let text;
  if (keywords.length >= 2) {
    text = `【演示复述】这可能是在问：「${clause}」背后的困惑。我暂时理解为，你在意「${keywords[0]}」以及它和「${keywords[1]}」的关系；这是推测，你可以纠正。`;
  } else if (keywords.length === 1) {
    text = `【演示复述】这可能是在问：「${clause}」背后的困惑。我暂时理解为，核心在「${keywords[0]}」；这是推测，你可以纠正。`;
  } else {
    text = `【演示复述】这可能是在问：「${clause}」背后的困惑。目前只能复述到这里，具体指向仍是推测，你可以纠正。`;
  }
  return clamp(text, 100);
}

const HINTS = [
  (keywords) => ({ type: '留住一个词', text: keywords[0] ? `「${keywords[0]}」是最重要的那个词吗？还是另有一个词更舍不得丢掉？` : '回看草稿：哪个词是你最不想丢掉的？只把那个词留下。' }),
  (keywords) => ({ type: '回到具体经验', text: keywords[0] ? `「${keywords[0]}」让你想起哪一次真实经历？只回忆那个场景里发生了什么。` : '这件事让你想起哪一次真实经历？只回忆那个场景。' }),
  (keywords) => ({ type: '寻找关系', text: keywords.length >= 2 ? `「${keywords[0]}」和「${keywords[1]}」之间是什么关系：因果、先后，还是矛盾？` : '草稿中的两件事之间可能是什么关系？' }),
  () => ({ type: '寻找反例', text: '什么情况下，你刚才的判断会不成立？一个例子也算。' }),
  () => ({ type: '回到目标', text: '你最初希望解决的具体问题是什么？用一句话说，不用完整。' }),
  () => ({ type: '缩小范围', text: '如果只能先弄清楚一小点，你最想从哪一点开始？' }),
];

function hints(draft, offset) {
  const keywords = extractKeywords(draft, 3);
  const start = ((Number.isInteger(offset) ? offset : 0) * 3) % HINTS.length;
  return [0, 1, 2].map((index) => {
    const hint = HINTS[(start + index) % HINTS.length](keywords);
    return Object.assign({ id: `demo-h${start + index}`, demo: true }, hint);
  });
}

function tokenize(text) {
  const tokens = new Set();
  const parts = String(text || '').toLowerCase().match(/[一-龥]+|[a-z0-9]+/g) || [];
  parts.forEach((part) => {
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length >= 2 && !STOP_TOKENS.has(part)) tokens.add(part);
      return;
    }
    if (part.length === 1) {
      if (!STOP_TOKENS.has(part)) tokens.add(part);
      return;
    }
    for (let index = 0; index < part.length - 1; index += 1) {
      const token = part.slice(index, index + 2);
      if (!STOP_TOKENS.has(token)) tokens.add(token);
    }
  });
  return tokens;
}

function overlapScore(draft, message) {
  const left = tokenize(draft);
  const right = tokenize(message);
  const matched = [...left].filter((token) => right.has(token));
  if (!matched.length || !left.size || !right.size) return { score: 0, matched };
  const dice = (2 * matched.length) / (left.size + right.size);
  return { score: Math.round(dice * 100), matched };
}

function recall(draft, userMessages) {
  const ranked = userMessages
    .map((message, index) => {
      const result = overlapScore(draft, message.text);
      return {
        id: message.id,
        text: message.text,
        score: result.score,
        matched: result.matched,
        index,
      };
    })
    .filter((message) => message.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5);

  const evidence = ranked.map((message) => ({ id: message.id, text: message.text, score: message.score }));
  const cues = ranked.slice(0, 3).map((message) => `回看原文 ${message.id}：「${clamp(message.text, 80)}」`);
  const matchedTerms = ranked.length ? ranked[0].matched.slice(0, 3) : [];
  const aiAdditions = matchedTerms.length
    ? [`演示新增（非原文）：「${matchedTerms[0]}」在这里具体指什么？`]
    : [];
  const uncertainty = evidence.length
    ? '分数仅表示草稿与原文的中文二字片段、英文词重叠程度，不表示真实遗忘概率，也不能确认语义或因果关系。'
    : '未找到与草稿有有效词语重叠的用户原文，因此不生成证据、回忆线索或新增内容；评分不代表真实遗忘概率。';

  return {
    demo: true,
    evidence,
    cues,
    uncertainty,
    aiAdditions,
    scoring: 'Dice 词语重叠：2 × 共同词片段数 ÷（草稿词片段数 + 原话词片段数），换算为 0–100。',
  };
}

function answer(input) {
  const draft = input.draft;
  const question = typeof input.question === 'string' && input.question.trim() ? input.question.trim() : '';
  const keywords = extractKeywords(`${draft} ${question}`, 2);
  const facts = [`你提供的草稿原文是：「${clamp(draft, 160)}」。`];
  if (question) facts.push(`你当前确认的问题是：「${clamp(question, 120)}」。`);

  return {
    demo: true,
    facts,
    assumptions: [
      keywords.length >= 2
        ? `一种可能的解释是：「${keywords[0]}」和「${keywords[1]}」在你的情境中互相关联。（演示推测，不是事实结论。）`
        : `一种可能的解释是：「${keywords[0] || firstClause(draft, 24)}」与尚未说清的具体情境有关。（演示推测，不是事实结论。）`,
    ],
    missing: [
      '这个困惑出现的具体时间、地点和前后事件。',
      '你希望得到的结果，以及已经尝试过但没有奏效的做法。',
    ],
    next: [
      keywords[0] ? `找一个具体场景，写下「${keywords[0]}」当时是什么意思，再对照现在的用法。` : '找一个具体场景，用一句话写下当时发生了什么。',
      '先验证最小的一项假设，并记录什么证据会让你修改现在的理解。',
    ],
  };
}

module.exports = { restate, hints, recall, answer, extractKeywords, overlapScore };
