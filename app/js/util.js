/* 思迹 · 工具函数 */
(function () {
  const SJ = (window.SJ = window.SJ || {});

  SJ.util = {
    uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    // 纯文本 → 安全 HTML（换行转 <br>）
    textToHtml(s) {
      return SJ.util.esc(s).replace(/\n/g, '<br>');
    },

    fmtTime(ts) {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    fmtDate(ts) {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },

    timeOnly(ts) {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    // 相对时间：刚刚 / n 分钟前 / n 小时前 / 日期
    relTime(ts) {
      const diff = Date.now() - ts;
      const min = Math.floor(diff / 60000);
      if (min < 1) return '刚刚';
      if (min < 60) return `${min} 分钟前`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr} 小时前`;
      const day = Math.floor(hr / 24);
      if (day < 7) return `${day} 天前`;
      return SJ.util.fmtDate(ts);
    },

    // 生成默认标题：取原文前 18 字
    makeTitle(text) {
      const t = String(text || '').replace(/\s+/g, ' ').trim();
      return t.length > 18 ? t.slice(0, 18) + '…' : t || '未命名思考';
    },

    clamp(s, n) {
      s = String(s || '');
      return s.length > n ? s.slice(0, n) : s;
    },

    debounce(fn, ms) {
      let t = null;
      return function () {
        clearTimeout(t);
        const args = arguments;
        t = setTimeout(() => fn.apply(null, args), ms);
      };
    },
  };
})();
