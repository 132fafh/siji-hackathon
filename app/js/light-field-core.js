(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightField = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEFAULT_KEYWORDS = [
    '好奇心', '微小灵感', '未完成', '慢下来', '新方向', '留白',
    '此刻', '想象力', '再试一次', '日常切片', '一个问题', '勇气',
    '可能性', '倾听', '松弛感', '出发', '微光', '柔软边界',
  ];

  const FUNCTION_WORDS = [
    '的', '了', '和', '是', '在', '我', '你', '他', '她', '它', '就', '都', '也', '与', '及',
    '被', '把', '让', '向', '从', '到', '对', '为', '之', '其', '这', '那', '有', '无', '不',
    '要', '会', '能', '可', '该', '各', '每', '吗', '呢', '吧', '啊', '呀', '哦', '嘛', '呗',
    '着', '过', '地', '得', '又', '再', '只', '最', '更', '但', '而', '且', '或',
  ];
  const FUNCTION_SET = new Set(FUNCTION_WORDS);
  const DIRECTION_WORDS = [
    '为什么', '为何', '什么', '怎么', '怎样', '如何', '哪里', '哪个', '是否', '能否',
    '能不能', '要不要', '怎么办', '下一步', '新方向', '方向', '选择', '出发', '可能性', '未知', '一个问题',
  ];

  function normalized(text) {
    return String(text == null ? '' : text).trim().toLocaleLowerCase();
  }

  function classifyKeyword(keyword) {
    const text = normalized(keyword);
    if (FUNCTION_SET.has(text)) return 'function';
    if (DIRECTION_WORDS.some((word) => text.includes(word))) return 'direction';
    return 'content';
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function bubbleColor(x, y, time, category, pointer) {
    const px = Number(x) || 0;
    const py = Number(y) || 0;
    const t = Number(time) || 0;
    const qx = Math.sin(px * 3.4 + t * 0.13) + Math.cos(py * 2.8 - t * 0.09);
    const qy = Math.cos(px * 2.6 - t * 0.08) + Math.sin(py * 3.2 + t * 0.11);
    const field = 0.5 + 0.5 * Math.sin((px + qx * 0.15) * 4.1 + (py + qy * 0.14) * 3.3 + t * 0.17);
    const secondary = 0.5 + 0.5 * Math.cos((py - qy * 0.12) * 4.4 - (px + qx * 0.1) * 2.5 - t * 0.12);
    const breath = 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(t * 0.22));
    let r;
    let g;
    let b;

    if (category === 'function') {
      r = 82 + field * 22;
      g = 101 + secondary * 19;
      b = 121 + field * 19;
    } else if (category === 'direction') {
      r = 166 + field * 30;
      g = 112 + secondary * 27;
      b = 75 + (1 - field) * 35;
    } else {
      const teal = [61, 157, 139];
      const blue = [70, 105, 168];
      const violet = [124, 88, 159];
      const first = field < 0.5 ? teal : blue;
      const second = field < 0.5 ? blue : violet;
      const mix = field < 0.5 ? field * 2 : (field - 0.5) * 2;
      r = first[0] + (second[0] - first[0]) * mix;
      g = first[1] + (second[1] - first[1]) * mix;
      b = first[2] + (second[2] - first[2]) * mix;
    }

    let lift = 0;
    if (pointer) {
      const dx = px - (Number(pointer.x) || 0);
      const dy = py - (Number(pointer.y) || 0);
      lift = Math.exp(-(dx * dx + dy * dy) * 7) * (Number(pointer.energy) || 0) * 22;
    }
    return {
      r: clampByte(r * breath + lift),
      g: clampByte(g * breath + lift),
      b: clampByte(b * breath + lift),
    };
  }

  function relativeLuminance(color) {
    const channels = [color.r, color.g, color.b].map((value) => {
      const channel = Math.max(0, Math.min(255, Number(value) || 0)) / 255;
      return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function contrastRatio(first, second) {
    const a = relativeLuminance(first);
    const b = relativeLuminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function textToneForBackground(color, backdrop, alpha) {
    let effective = color;
    if (backdrop) {
      const amount = alpha == null ? 0.42 : Math.max(0, Math.min(1, alpha));
      effective = {
        r: color.r * amount + backdrop.r * (1 - amount),
        g: color.g * amount + backdrop.g * (1 - amount),
        b: color.b * amount + backdrop.b * (1 - amount),
      };
    }
    const dark = { r: 18, g: 29, b: 38 };
    const light = { r: 240, g: 247, b: 248 };
    return contrastRatio(effective, dark) > contrastRatio(effective, light) ? 'dark' : 'light';
  }

  function getTransitionPhase(elapsed, reducedMotion) {
    const time = Math.max(0, Number(elapsed) || 0);
    if (time < 650) return 'gather';
    if (reducedMotion) return 'idle';
    if (time < 1030) return 'burst';
    if (time < 1480) return 'arrive';
    return 'idle';
  }

  function dedupeKeywords(keywords) {
    if (!Array.isArray(keywords)) return [];
    const seen = new Set();
    const result = [];
    keywords.forEach((keyword) => {
      const text = String(keyword == null ? '' : keyword).trim();
      const key = normalized(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(text);
    });
    return result;
  }

  function keywordPool(keywords) {
    const list = dedupeKeywords(keywords);
    if (!list.length) return DEFAULT_KEYWORDS.slice();
    if (list.length === 1) {
      const supplement = DEFAULT_KEYWORDS.find((word) => normalized(word) !== normalized(list[0]));
      list.push(supplement);
    }
    return list;
  }

  function rotateKeywords(keywords, offset) {
    const list = dedupeKeywords(keywords);
    if (!list.length) return [];
    const start = ((Math.trunc(Number(offset) || 0) % list.length) + list.length) % list.length;
    return list.slice(start).concat(list.slice(0, start));
  }

  function nextKeyword(keywords, cursor, avoid) {
    const list = keywordPool(keywords);
    let index = ((Math.trunc(Number(cursor) || 0) % list.length) + list.length) % list.length;
    if (normalized(list[index]) === normalized(avoid) && list.length > 1) {
      index = (index + 1) % list.length;
    }
    return { text: list[index], cursor: (index + 1) % list.length };
  }

  function getBubbleCount(width) {
    return Number(width) <= 640 ? 5 : 8;
  }

  function createInitialBubbles(keywords, options) {
    const opts = options || {};
    const width = Number(opts.width) || 1024;
    const mobile = width <= 640;
    const count = getBubbleCount(width);
    const pool = keywordPool(keywords);
    const bubbles = [{
      id: 'light-bubble-current',
      text: pool[0],
      x: 50,
      y: 50,
      size: mobile ? 76 : 92,
      current: true,
      driftX: 3,
      driftY: 4,
      duration: 12,
      delay: -2,
    }];

    for (let index = 0; index < count - 1; index++) {
      const angle = -Math.PI / 2 + (index / (count - 1)) * Math.PI * 2;
      const radiusX = mobile ? 35 : 39;
      const radiusY = mobile ? 35 : 36;
      bubbles.push({
        id: 'light-bubble-' + (index + 1),
        text: pool[(index + 1) % pool.length],
        x: Number((50 + Math.cos(angle) * radiusX + Math.sin(index * 4.7) * 1.3).toFixed(2)),
        y: Number((50 + Math.sin(angle) * radiusY + Math.cos(index * 3.9) * 1.4).toFixed(2)),
        size: (mobile ? 36 : 42) + ((index * 17) % (mobile ? 11 : 15)),
        current: false,
        driftX: 4 + ((index * 5) % 6),
        driftY: 5 + ((index * 7) % 7),
        duration: 9 + ((index * 13) % 70) / 10,
        delay: -((index * 17) % 90) / 10,
      });
    }
    return bubbles;
  }

  function getMotionOptions(reducedMotion) {
    const reduced = Boolean(reducedMotion);
    return {
      reducedMotion: reduced,
      drift: !reduced,
      particleCount: reduced ? 0 : 9,
      pulseDuration: reduced ? 450 : 1150,
      burstDuration: reduced ? 0 : 380,
      longPressMs: 650,
    };
  }

  return {
    DEFAULT_KEYWORDS,
    FUNCTION_WORDS,
    classifyKeyword,
    bubbleColor,
    relativeLuminance,
    contrastRatio,
    textToneForBackground,
    getTransitionPhase,
    dedupeKeywords,
    keywordPool,
    rotateKeywords,
    nextKeyword,
    getBubbleCount,
    createInitialBubbles,
    getMotionOptions,
  };
});
