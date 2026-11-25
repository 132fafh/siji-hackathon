/* 思迹 · 设置页：AI 服务配置 + 数据管理 */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;
  SJ.views = SJ.views || {};

  SJ.views.settings = function (main) {
    const st = SJ.store.getSettings();

    main.innerHTML = `
      <div class="ws-head"><div>
        <h1 class="ws-title">设置</h1>
        <p class="ws-meta">所有配置仅保存在本机浏览器。</p>
      </div></div>

      <section class="card" aria-label="AI 服务">
        <p class="node-label">AI 服务</p>

        <div class="mode-choose" role="radiogroup" aria-label="AI 模式">
          <label class="mode-option">
            <input type="radio" name="ai-mode" value="demo" ${st.mode !== 'api' ? 'checked' : ''}>
            <span class="mode-name">演示模式（默认）</span>
            <span class="mode-desc">本地规则生成内容，无需密钥。所有 AI 内容都会标注「演示模式」，不伪装成真实 AI 能力。</span>
          </label>
          <label class="mode-option">
            <input type="radio" name="ai-mode" value="api" ${st.mode === 'api' ? 'checked' : ''}>
            <span class="mode-name">API 模式</span>
            <span class="mode-desc">连接 OpenAI 兼容接口。调用前请了解：将发送你的原始表达与澄清过程到所配置的端点。</span>
          </label>
        </div>

        <div class="api-fields ${st.mode === 'api' ? '' : 'hidden'}" data-api-fields>
          <div class="field">
            <label for="api-base">API 端点（Base URL）</label>
            <input id="api-base" type="url" placeholder="https://api.openai.com/v1" value="${u.esc(st.baseUrl)}">
          </div>
          <div class="field">
            <label for="api-model">模型</label>
            <input id="api-model" type="text" placeholder="gpt-4o-mini" value="${u.esc(st.model)}">
          </div>
          <div class="field">
            <label for="api-key">API 密钥</label>
            <input id="api-key" type="password" placeholder="sk-..." value="${u.esc(st.apiKey)}" autocomplete="off">
            <p class="field-note">密钥只保存在本机浏览器（localStorage），不会上传到其他地方。浏览器直连第三方 API 时，密钥理论上对该端点可见；生产环境请改用后端代理。</p>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-ghost" data-test>测试连接</button>
            <span class="muted" data-test-result aria-live="polite"></span>
          </div>
        </div>

        <div class="btn-row" style="margin-top:16px">
          <button type="button" class="btn btn-primary" data-save-ai>保存 AI 配置</button>
          <span class="muted" data-save-result aria-live="polite"></span>
        </div>
      </section>

      <section class="card" aria-label="数据与隐私">
        <p class="node-label">数据与隐私</p>
        <p>历史记录保存在<strong>${u.esc(SJ.store.dataLocation())}</strong>。不默认上传任何原始思考内容。</p>
        <p class="muted">接入云端 AI 后，一次思考仅在对应环节发送必要文本：复述/提示/暂定问题/回答，具体见各步骤。导出 Markdown 只在本地生成文件。</p>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" data-export-json>导出全部数据（JSON）</button>
          <button type="button" class="btn btn-ghost btn-danger-text" data-clear>删除全部本地数据</button>
        </div>
      </section>

      <section class="card" aria-label="关于">
        <p class="node-label">关于思迹</p>
        <p class="muted">先留痕，再澄清，后回答。AI 提供镜子和候选，人始终保留判断权。</p>
        <p class="muted">本产品不诊断心理状态、不测量 IQ、不判断固定思维类型、不预测你"真正想什么"。</p>
      </section>`;

    /* 模式切换显隐 */
    main.querySelectorAll('input[name="ai-mode"]').forEach((r) => {
      r.addEventListener('change', () => {
        main.querySelector('[data-api-fields]').classList.toggle('hidden', r.value !== 'api');
      });
    });

    main.querySelector('[data-save-ai]').addEventListener('click', () => {
      const mode = main.querySelector('input[name="ai-mode"]:checked').value;
      SJ.store.saveSettings({
        mode,
        baseUrl: main.querySelector('#api-base').value.trim(),
        model: main.querySelector('#api-model').value.trim(),
        apiKey: main.querySelector('#api-key').value.trim(),
      });
      main.querySelector('[data-save-result]').textContent = '已保存。';
      SJ.ui.toast('设置已保存');
      SJ.app.render();
      /* 重新渲染会丢失保存提示，简单补一个 toast 即可 */
    });

    main.querySelector('[data-test]').addEventListener('click', async () => {
      SJ.store.saveSettings({
        mode: 'api',
        baseUrl: main.querySelector('#api-base').value.trim(),
        model: main.querySelector('#api-model').value.trim(),
        apiKey: main.querySelector('#api-key').value.trim(),
      });
      const out = main.querySelector('[data-test-result]');
      out.textContent = '正在测试……';
      try {
        const t = await SJ.ai.testConnection();
        out.textContent = `连接正常：${u.clamp(t, 40)}`;
      } catch (e) {
        out.textContent = '失败：' + u.clamp(e.message, 80);
      }
    });

    main.querySelector('[data-export-json]').addEventListener('click', () => {
      const blob = new Blob([SJ.store.exportJSON()], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `思迹-全部数据-${u.fmtDate(Date.now())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      SJ.ui.toast('已导出 JSON');
    });

    main.querySelector('[data-clear]').addEventListener('click', () => {
      SJ.ui.confirm('删除全部本地数据？', '所有思考记录将从当前浏览器中永久删除，无法恢复。建议先导出 JSON 备份。', () => {
        SJ.store.clearAll();
        SJ.ui.toast('本地数据已清空');
        location.hash = '#/new';
        SJ.app.render();
      });
    });
  };
})();
