/* 思迹 · Node 冒烟测试（无浏览器环境）
 * 运行：node test/run-tests.js
 * 覆盖：store 数据层、演示 AI 行为约束、完整流程模拟、Markdown 导出。
 */
'use strict';

/* ---------- 浏览器环境 shim ---------- */
const storageMap = new Map();
global.localStorage = {
  getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: (k) => storageMap.delete(k),
};
global.window = global;
global.document = {
  createElement: () => ({ style: {}, setAttribute() {}, click() {}, remove() {} }),
  body: { appendChild() {} },
};

const path = require('path');
const load = (f) => require(path.join(__dirname, '..', 'js', f));
load('util.js');
load('store.js');
load('demo-ai.js');
load('ai-service.js');
load('export.js');

const SJ = global.SJ;

/* ---------- 断言工具 ---------- */
let passed = 0;
let failed = 0;
function ok(cond, name, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${extra ? ' —— ' + extra : ''}`);
  }
}
function section(t) {
  console.log('\n■ ' + t);
}

/* ---------- 1. store 数据层 ---------- */
section('store 数据层');
{
  const s = SJ.store.createSession('  我不知道自己为什么总是拖延，明明很想把项目做完，却一直在刷手机。 ');
  ok(s && s.id, 'createSession 返回会话');
  ok(s.original.text.trim() === '我不知道自己为什么总是拖延，明明很想把项目做完，却一直在刷手机。', '原始表达已保存并去首尾空白');
  const origSnapshot = JSON.stringify(s.original);

  const hacked = SJ.store.updateSession(s.id, { original: { text: '被篡改', ts: 1 }, title: 'x' });
  ok(JSON.stringify(hacked.original) === origSnapshot, 'updateSession 无法覆盖 original（不可被 AI 修改）');
  ok(hacked.title === 'x', 'updateSession 正常更新其他字段');

  const renamed = SJ.store.renameSession(s.id, '拖延症之困');
  ok(renamed.title === '拖延症之困', '重命名生效');

  const s2 = SJ.store.createSession('第二个想法');
  const list = SJ.store.listSessions();
  ok(list.length === 2 && list[0].id === s2.id, '列表按更新时间倒序');

  // 持久化：直接读底层存储验证
  const raw = JSON.parse(storageMap.get('siji.sessions'));
  ok(raw.length === 2, '数据确实写入 localStorage');

  SJ.store.deleteSession(s2.id);
  ok(SJ.store.listSessions().length === 1, '删除生效');
  ok(SJ.store.getSettings().mode === 'demo', '默认设置为 demo 模式');
}

/* ---------- 2. 演示 AI 行为约束 ---------- */
section('演示 AI 行为约束');
{
  const session = SJ.store.createSession('我在考虑要不要辞职去做自由职业，担心收入不稳定，但又实在厌倦现在的通勤。');

  SJ.demoAI.restate(session).then((r) => {
    ok(typeof r === 'string' && r.length > 0, 'restate 返回非空字符串');
    ok(r.length <= 100, `restate 不超过 100 字（实际 ${r.length} 字）`);
    ok(r.includes('这可能是在问') || r.includes('我暂时理解'), 'restate 使用可纠正措辞');
    ok(r.includes('推测'), 'restate 明确标注推测');
    ok(!r.includes('你真正想问的是'), 'restate 不使用确定性表达');

    return SJ.demoAI.hints(session, 0);
  }).then((hints) => {
    ok(Array.isArray(hints) && hints.length === 3, `hints 恰好三张（实际 ${hints.length}）`);
    ok(hints.every((h) => h.type && h.text && h.text.length <= 120), '每张提示卡有类型和简短文本');
    return SJ.demoAI.hints(session, 1);
  }).then((hints2) => {
    ok(hints2.length === 3 && hints2[0].text !== undefined, '换一组（offset=1）仍返回三张');

    return SJ.demoAI.draft(session);
  }).then((d) => {
    ok(d && d.text && d.userPart && typeof d.aiPart === 'string', 'draft 返回 {text, userPart, aiPart}');
    ok(d.text.includes('推测') || d.aiPart.includes('推测'), 'draft 标注 AI 推测部分');
    ok(d.text.length <= 150, `draft 长度克制（实际 ${d.text.length} 字）`);
    return SJ.demoAI.answer(Object.assign({}, session, { confirmed: { text: d.text, ts: Date.now() } }));
  }).then(async (a) => {
    ok(a.demo === true, '演示回答带 demo 标记');
    ok(Array.isArray(a.facts) && a.facts.length >= 1, '回答含「事实」段');
    ok(a.facts.every((x) => x && x.trim().length > 0), '事实段每条均非空');
    ok(!JSON.stringify(a.facts).includes('例如：「」'), '事实段引用用户原话不为空');
    ok(Array.isArray(a.assumptions) && a.assumptions.length >= 1, '回答含「假设」段');
    ok(Array.isArray(a.missing) && a.missing.length >= 1, '回答含「缺少信息」段');
    ok(Array.isArray(a.next) && a.next.length >= 1, '回答含「验证方向」段');

    // 跳过的轮次（空回答）不计入补充次数
    const sSkip = SJ.store.createSession('测试跳过轮次');
    SJ.store.updateSession(sSkip.id, {
      rounds: [
        { n: 1, answer: { text: '真正补充的内容在这里。', ts: Date.now() }, draft: null },
        { n: 2, answer: { text: '', ts: Date.now(), skipped: true }, draft: null },
      ],
      confirmed: { text: '测试问题', ts: Date.now() },
    });
    const aSkip = await SJ.demoAI.answer(SJ.store.getSession(sSkip.id));
    ok(aSkip.facts[1].includes('补充了 1 次'), '跳过轮次不计入补充次数');
    ok(aSkip.facts[1].includes('真正补充的内容'), '事实引用最后一条真实回答');

    runFlowTests();
  }).catch((e) => {
    failed++;
    console.error('  ✗ 演示 AI 测试异常:', e);
    runFlowTests();
  });
}

/* ---------- 3. 完整流程模拟（工作区状态机同款数据操作） ---------- */
function runFlowTests() {
  section('完整流程模拟');
  (async () => {
    // 原话输入
    const s = SJ.store.createSession('想写一本关于县城青年的小说，但一直开不了头，总觉得准备还不够。');
    ok(s.status === 'clarifying', '新会话状态为 clarifying');

    // AI 复述（异步）
    const restatement = await SJ.ai.restate(s);
    const rounds = [{ n: 1, restatement, hints: null, hintOffset: 0, chosenHint: null, answer: null, draft: null, corrections: [] }];
    SJ.store.updateSession(s.id, { rounds, aiSource: SJ.ai.source() });

    // 第一轮：选择提示并回答
    const hints = await SJ.ai.hints(SJ.store.getSession(s.id), 0);
    const s1 = SJ.store.getSession(s.id);
    const r1 = rounds.slice();
    r1[0] = Object.assign({}, r1[0], { hints, chosenHint: hints[0], answer: { text: '最重要的词可能是「县城」，我自己就是从县城出来的。', ts: Date.now() } });
    SJ.store.updateSession(s.id, { rounds: r1 });
    const d1 = await SJ.ai.draft(SJ.store.getSession(s.id));
    const r1b = SJ.store.getSession(s.id).rounds.slice();
    r1b[0] = Object.assign({}, r1b[0], { draft: d1 });
    SJ.store.updateSession(s.id, { rounds: r1b });

    // 否定 AI 理解（纠正）
    SJ.store.updateSession(s.id, {
      misunderstandings: [{ text: '不是开不了头，是怕写出来太私人。', ts: Date.now() }],
    });

    // 第二、三轮
    for (let n = 2; n <= 3; n++) {
      const cur = SJ.store.getSession(s.id).rounds;
      const more = cur.concat([{ n, restatement: null, hints: null, hintOffset: 0, chosenHint: null, answer: null, draft: null, corrections: [] }]);
      SJ.store.updateSession(s.id, { rounds: more });
      const ans = { text: n === 2 ? '和前年回乡那次有关，亲戚问收入时的窒息感。' : '我最初想解决的是：要不要先把第一篇发出来。', ts: Date.now() };
      const rr = SJ.store.getSession(s.id).rounds.slice();
      rr[rr.length - 1] = Object.assign({}, rr[rr.length - 1], { answer: ans });
      SJ.store.updateSession(s.id, { rounds: rr });
      const dd = await SJ.ai.draft(SJ.store.getSession(s.id));
      const rr2 = SJ.store.getSession(s.id).rounds.slice();
      rr2[rr2.length - 1] = Object.assign({}, rr2[rr2.length - 1], { draft: dd });
      SJ.store.updateSession(s.id, { rounds: rr2 });
    }

    let sNow = SJ.store.getSession(s.id);
    ok(sNow.rounds.length === 3, '完成三轮澄清');
    ok(sNow.rounds.every((r) => r.draft && r.draft.text), '每轮都有暂定问题');
    ok(sNow.misunderstandings.length === 1, '纠正被记录（用户否定过的 AI 理解）');

    // 空白 → 暂停 → 恢复
    SJ.store.updateSession(s.id, { blanks: [{ startedAt: Date.now(), option: 'pause' }], status: 'blank' });
    sNow = SJ.store.getSession(s.id);
    const lastBlank = sNow.blanks[sNow.blanks.length - 1];
    ok(lastBlank && !lastBlank.resumedAt, '空白状态被记录');
    const blanks = sNow.blanks.slice();
    blanks[blanks.length - 1] = Object.assign({}, lastBlank, { resumedAt: Date.now(), verdict: 'modified' });
    SJ.store.updateSession(s.id, { blanks, status: 'clarifying' });

    // 确认问题 → 生成回答
    const finalDraft = sNow.rounds[2].draft.text;
    SJ.store.updateSession(s.id, { confirmed: { text: finalDraft, ts: Date.now() }, status: 'confirmed' });
    const ans = await SJ.ai.answer(SJ.store.getSession(s.id));
    SJ.store.updateSession(s.id, { answer: Object.assign({ ts: Date.now(), feedback: 'helpful' }, ans), status: 'answered' });    sNow = SJ.store.getSession(s.id);
    ok(sNow.status === 'answered', '状态推进到 answered');
    ok(sNow.confirmed && sNow.confirmed.text === finalDraft, '确认的问题被保存');
    ok(sNow.answer.facts.length > 0 && sNow.answer.feedback === 'helpful', '回答与反馈已保存');
    ok(JSON.parse(JSON.stringify(sNow.original)).text.includes('县城青年'), '原始表达完整保留到最后');

    // 新方向分支
    SJ.store.updateSession(s.id, { branches: [{ text: '也许不写小说，先写一组散文。', ts: Date.now() }] });
    const dAfter = await SJ.ai.draft(SJ.store.getSession(s.id));
    ok(dAfter.text.length > 0, '存在分支时 draft 仍正常生成');

    // 导出
    const md = SJ.exporter.sessionToMarkdown(SJ.store.getSession(s.id));
    ok(md.includes('## 原始表达'), '导出含原始表达段');
    ok(md.includes('## 澄清过程'), '导出含澄清过程段');
    ok(md.includes('## 空白与恢复'), '导出含空白与恢复段');
    ok(md.includes('## 回答'), '导出含回答段');
    ok(md.includes('被否定的 AI 理解'), '导出含被否定的理解段');

    // 反馈「理解错了」返回修改：状态机回到 clarifying
    SJ.store.updateSession(s.id, {
      status: 'clarifying',
      rounds: SJ.store.getSession(s.id).rounds.concat([{ n: 4, restatement: null, hints: null, hintOffset: 0, chosenHint: null, answer: null, draft: null, corrections: [] }]),
    });
    ok(SJ.store.getSession(s.id).status === 'clarifying' && SJ.store.getSession(s.id).rounds.length === 4, '反馈理解错误后可返回继续澄清');

    summary();
  })().catch((e) => {
    failed++;
    console.error('  ✗ 流程模拟异常:', e);
    summary();
  });
}

function summary() {
  console.log(`\n──────────────\n通过 ${passed} 项，失败 ${failed} 项。`);
  process.exit(failed ? 1 : 0);
}
