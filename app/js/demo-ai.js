/* 思迹 · 演示模式 AI（规则生成，非真实 AI）
 *
 * 重要：本模块只是为了让完整交互流程在没有 API 密钥时也能运行。
 * 输出全部由固定规则拼合，能力有限，界面全程标注「演示模式」。
 * 接入真实 AI 请使用 ai-service.js 的 API 模式。
 */
(function () {
  const SJ = (window.SJ = window.SJ || {});

  /* 常见虚词/功能词，用于粗粒度关键词提取 */
  const STOPWORDS = [
    '不知道', '为什么', '是不是', '有没有', '能不能', '会不会', '怎么样', '怎么办', '什么意思',
    '我觉得', '我感觉', '我认为', '我在想', '就是说', '或者说', '说到底', '实际上', '其实',
    '因为', '所以', '但是', '然后', '而且', '不过', '虽然', '如果', '或者', '以及', '并且',
    '一个', '这个', '那个', '什么', '怎么', '这样', '那样', '现在', '有点', '真的', '应该',
    '可能', '就是', '不是', '没有', '可以', '不会', '不能', '还是', '已经', '正在', '非常',
    '特别', '比较', '大概', '也许', '好像', '似乎', '总是', '经常', '有时', '关于', '对于',
    '自己', '我们', '你们', '他们', '它们', '以及', '等等', '之类的', '一下', '一些', '件事',
    '的时候', '的地方', '的东西', '我觉得', '不确定', '想不通', '很', '太', '都', '也', '还',
    '的', '了', '和', '是', '在', '我', '你', '他', '她', '它', '就', '都', '也', '与', '及',
    '被', '把', '让', '向', '从', '到', '对', '为', '之', '其', '这', '那', '有', '无', '不',
    '要', '会', '能', '可', '该', '各', '每', '啥', '怎', '吗', '呢', '吧', '啊', '呀', '哦',
    '嘛', '呗', '着', '过', '地', '得', '又', '再', '只', '最', '更', '但', '而', '且', '或',
  ];

  /* 按停顿切分小句 */
  function clauses(text) {
    return String(text || '')
      .split(/[，。！？；、,.!?;：:\n\r\t\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
  }

  /* 粗粒度关键词：去虚词后取内容片段，按 频次+长度 打分 */
  function extractKeywords(text, n) {
    n = n || 3;
    let work = String(text || '');
    if (!work.trim()) return [];
    // 先统一标点/符号为分隔符，避免词段夹带逗号等
    work = work.replace(/[，。！？；、,.!?;：:""''（）()\[\]【】\-—…·\s]+/g, '');
    // 长的停用词先替换，再处理单字
    const sorted = STOPWORDS.slice().sort((a, b) => b.length - a.length);
    sorted.forEach((w) => {
      work = work.split(w).join('');
    });
    const segs = work
      .split('')
      .map((s) => s.trim())
      .filter((s) => /^[一-龥A-Za-z0-9]+$/.test(s) && s.length >= 2 && s.length <= 10);

    const score = new Map();
    segs.forEach((s) => {
      score.set(s, (score.get(s) || 0) + 1 + Math.min(s.length, 6) * 0.15);
    });

    const picked = [];
    const sortedSegs = [...score.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    for (const s of sortedSegs) {
      if (picked.length >= n) break;
      // 已被更长片段包含的短片段不再入选
      if (picked.some((p) => p.includes(s))) continue;
      picked.push(s);
    }
    return picked;
  }

  /* 聚合用户全部原话（原始表达 + 新方向分支 + 各轮回答），AI 只基于此工作 */
  function allUserText(session) {
    return (
      session.original.text +
      ' ' +
      (session.branches || []).map((b) => b.text).join(' ') +
      ' ' +
      session.rounds.map((r) => (r.answer ? r.answer.text : '')).join(' ')
    );
  }

  function answerCore(text, maxLen) {
    const cs = clauses(text);
    if (!cs.length) return SJ.util.clamp(text, maxLen || 30);
    return SJ.util.clamp(cs[cs.length - 1], maxLen || 30);
  }

  function origClause(text, maxLen) {
    const cs = clauses(text);
    if (!cs.length) return SJ.util.clamp(text, maxLen || 36);
    return SJ.util.clamp(cs[0], maxLen || 36);
  }

  const HINT_POOL = [
    (k) => ({
      type: '留住一个词',
      text: k[0]
        ? `刚才的内容里，「${k[0]}」这个词被反复提到。它是最重要的那个吗？还是另有一个词更舍不得丢掉？`
        : '回看刚才写下的内容：哪个词是你最不想丢掉的？只把那个词留下就好。',
    }),
    (k) => ({
      type: '回到具体经验',
      text: k[0]
        ? `「${k[0]}」让你想起哪一次真实的经历？不用总结道理，只回忆那个场景里发生了什么。`
        : '这件事让你想起哪一次真实的经历？不用总结道理，只回忆那个场景里发生了什么。',
    }),
    (k) => ({
      type: '寻找一个关系',
      text:
        k.length >= 2
          ? `「${k[0]}」和「${k[1]}」之间，你觉得可能是什么关系？是因果、先后，还是互相矛盾？`
          : '你提到的两件事之间可能是什么关系？是因果、先后，还是互相矛盾？',
    }),
    (k) => ({
      type: '找一个反例',
      text: k[0]
        ? `什么情况下，关于「${k[0]}」的这个判断会不成立？哪怕只想到一个例子也算。`
        : '什么情况下，你刚才说的这个判断会不成立？哪怕只想到一个例子也算。',
    }),
    (k) => ({
      type: '回到最初目标',
      text: '回到最开始：你最初希望解决的具体问题是什么？用一句话说，不用完整。',
    }),
    (k) => ({
      type: '缩小范围',
      text: k[0]
        ? `如果把「${k[0]}」先放到一边，剩下的部分里，你最想先弄清楚哪一小点？`
        : '如果把最让你纠结的部分先放到一边，剩下的内容里，你最想先弄清楚哪一小点？',
    }),
  ];

  const demo = {
    isDemo: true,

    /** 简短复述（≤100字，可纠正措辞，明确标注推测） */
    restate(session) {
      const text = session.original.text;
      const oc = origClause(text, 32);
      const k = extractKeywords(text, 2);
      let out;
      if (k.length >= 2) {
        out = `这可能是在问：「${oc}」背后的困惑。我暂时理解为，你在意的是「${k[0]}」；至于它和「${k[1]}」的关系，是我的推测，你可以随时纠正。`;
      } else if (k.length === 1) {
        out = `这可能是在问：「${oc}」背后的困惑。我暂时理解为，核心在「${k[0]}」，其余细节是我的推测，你可以随时纠正。`;
      } else {
        out = `这可能是在问：「${oc}」背后的困惑。目前我只能复述到这里，具体指向哪些内容是我的推测，你可以随时纠正。`;
      }
      // 保证不超过 100 字
      if (out.length > 100) {
        const oc2 = origClause(text, 20);
        out = k.length
          ? `这可能是在问：「${oc2}」背后的困惑。我暂时理解为你在意「${k[0]}」，这是我的推测，你可以纠正。`
          : `这可能是在问：「${oc2}」背后的困惑。目前只能复述到这里，你可以随时纠正。`;
        out = SJ.util.clamp(out, 100);
      }
      return Promise.resolve(out);
    },

    /** 生成三张提示卡（每次三个，可换一组） */
    hints(session, offset) {
      const allText = allUserText(session);
      const k = extractKeywords(allText, 3);
      const start = ((offset || 0) * 3) % HINT_POOL.length;
      const picked = [0, 1, 2].map((i) => HINT_POOL[(start + i) % HINT_POOL.length](k));
      return Promise.resolve(
        picked.map((h, i) => ({ id: 'h' + Date.now().toString(36) + i, type: h.type, text: h.text }))
      );
    },

    /** 更新暂定问题：拆分 用户部分 / AI 推测部分 */
    draft(session) {
      const oc = origClause(session.original.text, 28);
      const lastRound = session.rounds[session.rounds.length - 1];
      const core = lastRound && lastRound.answer ? answerCore(lastRound.answer.text, 26) : '';
      const allText = allUserText(session);
      const k = extractKeywords(allText, 2);

      let userPart = core ? `关于「${oc}」，结合你补充的「${core}」` : `关于「${oc}」`;
      let aiPart =
        k.length >= 2
          ? `我暂时推测你想弄清楚「${k[0]}」和「${k[1]}」之间的关系`
          : k.length === 1
            ? `我暂时推测关键在「${k[0]}」意味着什么`
            : '我暂时推测你想把它说成一个可以回答的问题';

      // 第三轮后收敛：把问题成形
      if (session.rounds.length >= 3) {
        aiPart =
          k.length >= 1
            ? `是否可以先回答：面对「${k[0]}」，下一步具体该做什么`
            : '是否可以先回答：下一步具体该做什么';
      }

      const text = `${userPart}——${aiPart}。`;
      return Promise.resolve({ text, userPart, aiPart });
    },

    /** 确认问题后生成完整回答（演示版：四段结构，内容保守、不编造） */
    answer(session) {
      const q = session.confirmed ? session.confirmed.text : '';
      const allText = allUserText(session);
      const k = extractKeywords(allText, 2);
      const oc = origClause(session.original.text, 30);
      // 只统计用户真正写了内容的回答（跳过的轮次不计）
      const answered = session.rounds.filter((r) => r.answer && r.answer.text && !r.answer.skipped);

      const facts = [
        `你的原始表达是：「${SJ.util.clamp(session.original.text, 80)}」。`,
        answered.length
          ? `澄清过程中你自己补充了 ${answered.length} 次，例如：「${answerCore(answered[answered.length - 1].answer.text, 40)}」。`
          : '你没有补充更多内容，直接从原始表达出发。',
        ...(session.confirmed ? [`你最终确认的问题是：「${SJ.util.clamp(q, 80)}」。`] : []),
      ];

      const assumptions = [
        k.length >= 2
          ? `基于「${k[0]}」和「${k[1]}」，一种可能的解释是：它们在你的情境里互相牵动，而不是单独成立。（这是基于你给出的内容的推测，不是结论。）`
          : `基于「${k[0] || oc}」，一种可能的解释是：它比表面上更贴近你真正要做出的那个决定。（这是推测，不是结论。）`,
        '另一种可能是：困扰你的不是问题本身，而是还没允许它先保持模糊。（同样是推测。）',
      ];

      const missing = [
        '这个困惑出现的具体场景（什么时候、在什么之前发生）。',
        '你期待的结果长什么样——哪怕只是一个模糊的画面。',
        '你已经试过但没有奏效的做法。',
      ];

      const next = [
        k[0] ? `把「${k[0]}」放在一个具体场景里问自己：这次和上次有什么不同？` : '把问题放进一个具体场景里，观察哪里最让你停顿。',
        k[1] ? `分别写下「${k[0]}」和「${k[1]}」各自的定义，再看它们是否还在冲突。` : '写下你对这个问题的一句话答案，隔一小时再读一遍，圈出仍不确定的词。',
        '如果一周内只能推进一小步，先验证最小的那部分假设。',
      ];

      return Promise.resolve({
        demo: true,
        facts,
        assumptions,
        missing,
        next,
      });
    },
  };

  SJ.demoAI = demo;
  SJ.demoAI._extractKeywords = extractKeywords; // 供「只看三个关键词」等功能复用
})();
