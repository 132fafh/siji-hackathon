/* 思迹 · Markdown 导出 */
(function () {
  const SJ = (window.SJ = window.SJ || {});

  function sessionToMarkdown(session) {
    const u = SJ.util;
    const L = [];
    const srcLabel = session.aiSource === 'api' ? '真实 AI（API）' : '演示模式（规则生成）';

    L.push(`# ${session.title}`);
    L.push('');
    L.push(`- 创建时间：${u.fmtTime(session.createdAt)}`);
    L.push(`- 最近更新：${u.fmtTime(session.updatedAt)}`);
    L.push(`- AI 来源：${srcLabel}`);
    L.push('');

    L.push('## 原始表达（未被修改）');
    L.push('');
    L.push(`> ${session.original.text.replace(/\n/g, '\n> ')}`);
    L.push('');
    L.push(`记录时间：${u.fmtTime(session.original.ts)}`);
    L.push('');

    if (session.rounds && session.rounds.length) {
      L.push('## 澄清过程');
      L.push('');
      session.rounds.forEach((r) => {
        L.push(`### 第 ${r.n} 轮`);
        L.push('');
        if (r.restatement) {
          L.push(`**AI 简短复述**（推测内容，可纠正）：`);
          L.push('');
          L.push(`> ${r.restatement}`);
          L.push('');
        }
        if (r.chosenHint) {
          L.push(`- 选择的提示（${r.chosenHint.type}）：${r.chosenHint.text}`);
        } else if (r.selfWritten) {
          L.push('- 用户选择自己直接补充，未选用提示。');
        }
        if (r.answer && r.answer.text) {
          L.push(`- 用户回答：${r.answer.text}`);
        }
        if (r.answer && r.answer.skipped) {
          L.push('- 用户选择跳过澄清，直接形成暂定问题。');
        }
        if (r.draft) {
          L.push('');
          L.push(`**暂定问题**：${r.draft.text}`);
          if (r.draft.aiPart) {
            L.push('');
            L.push(`> 其中 AI 推测部分：${r.draft.aiPart}`);
          }
        }
        L.push('');
      });
    }

    if (session.misunderstandings && session.misunderstandings.length) {
      L.push('## 被否定的 AI 理解');
      L.push('');
      session.misunderstandings.forEach((m) => {
        L.push(`- ${u.fmtTime(m.ts)}：${m.text}`);
      });
      L.push('');
    }

    if (session.blanks && session.blanks.length) {
      const optNames = { pause: '暂时停一下', keywords: '只看三个关键词', original: '回到原始表达', restart: '从新的方向开始' };
      const verdictNames = { back: '原来的想法回来了', modified: '这是对原想法的修改', new: '这是一个新方向' };
      L.push('## 空白与恢复');
      L.push('');
      session.blanks.forEach((b) => {
        L.push(`- ${u.fmtTime(b.startedAt)}：选择「${optNames[b.option] || b.option}」${b.resumedAt ? `，于 ${u.fmtTime(b.resumedAt)} 恢复` : '（尚未恢复）'}${b.verdict ? `；恢复时判断：${verdictNames[b.verdict] || b.verdict}` : ''}`);
      });
      L.push('');
    }

    if (session.thoughtMaps && Object.keys(session.thoughtMaps).length) {
      L.push('## 星落与局部思维导图');
      L.push('');
      const kindLabels = { concept: '概念', idea: '想法', question: '疑问', evidence: '依据', premise: '前提与边界', direction: '方向', conclusion: '结论', fragment: '片段' };
      const statusLabels = { active: '原路径', candidate: '待确认', accepted: '已接受', rejected: '已拒绝' };
      Object.values(session.thoughtMaps).forEach((graph) => {
        const root = (graph.nodes || []).find((node) => node.id === graph.rootId);
        L.push(`### ${root ? root.text : '未命名星点'}`);
        L.push('');
        (graph.nodes || []).forEach((node) => {
          const origin = node.sourceOrigin === 'ai' ? (node.labelOrigin === 'user_edit' ? 'AI 候选，用户修改' : node.demo ? 'AI 演示候选' : '真实 AI 候选') : '用户原话节点';
          L.push(`- [${kindLabels[node.kind] || node.kind}] ${node.text}（${origin}；${statusLabels[node.status] || node.status}）`);
          if (node.sourceQuote) L.push(`  - 来源原话：${node.sourceQuote}`);
        });
        (graph.edges || []).forEach((edge) => {
          const from = (graph.nodes || []).find((node) => node.id === edge.from);
          const to = (graph.nodes || []).find((node) => node.id === edge.to);
          if (from && to) L.push(`  - 关系：${from.text} → ${to.text}（${edge.type}；${statusLabels[edge.status] || edge.status}）`);
        });
        L.push('');
      });
      if (session.expansionPreferences && SJ.preferenceVector) {
        L.push(`本次扩展偏好：${SJ.preferenceVector.preferenceSummary(session.expansionPreferences)}。仅用于当前会话候选排序，不是人格画像。`);
        L.push('');
      }
    }

    if (session.confirmed) {
      L.push('## 最终确认的问题');
      L.push('');
      L.push(`> ${session.confirmed.text}`);
      L.push('');
      L.push(`确认时间：${u.fmtTime(session.confirmed.ts)}`);
      L.push('');
    }

    if (session.answer) {
      L.push('## 回答');
      L.push('');
      const a = session.answer;
      const sec = (title, arr) => {
        L.push(`### ${title}`);
        L.push('');
        (arr || []).forEach((x) => L.push(`- ${x}`));
        L.push('');
      };
      sec('相对确定的事实', a.facts);
      sec('基于假设的解释（推测）', a.assumptions);
      sec('仍然缺少的信息', a.missing);
      sec('可以继续验证的方向', a.next);
      if (a.feedback) {
        const fb = { accurate: '问题理解准确', helpful: '回答有帮助', wrong: 'AI 理解错了，已返回修改' };
        L.push(`用户反馈：${fb[a.feedback] || a.feedback}`);
        L.push('');
      }
    }

    L.push('---');
    L.push('由「思迹」导出 · 先留痕，再澄清，后回答。');
    return L.join('\n');
  }

  function download(session) {
    const md = sessionToMarkdown(session);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `思迹-${SJ.util.makeTitle(session.title).replace(/[\\/:*?"<>|\s]+/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  SJ.exporter = { sessionToMarkdown, download };
})();
