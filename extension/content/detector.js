(function () {
  'use strict';

  if (window.__sijiDetectorLoaded || !window.SijiTriggerEngine) {
    return;
  }
  window.__sijiDetectorLoaded = true;

  const engine = window.SijiTriggerEngine;
  const EDITOR_SELECTOR = [
    'textarea',
    'input[type="text"]',
    'input[type="search"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="textbox"]'
  ].join(',');
  const MESSAGE_SELECTOR = [
    '[data-message-author-role]',
    '[data-author-role]',
    '[data-role="user"]',
    '[data-role="assistant"]',
    '[data-message-id]',
    'article',
    '[role="article"]',
    'main [role="listitem"]'
  ].join(',');

  let currentSite = null;
  let detectorStarted = false;
  let settings = engine.getDefaultSettings();
  let lastPopupAt = null;
  let activeEditor = null;
  let interacted = false;
  let suppressedForThisPage = false;
  let userMessages = [];
  let lastAssistantLength = 0;
  let lastMessageRole = '';
  let history = [];
  let refreshTimer = null;
  let state = freshState();

  function freshState() {
    return {
      draft: '',
      previousDraft: '',
      lastActivityAt: Date.now(),
      inputEvents: 0,
      backspaces: 0,
      rewriteCount: 0,
      rereadCount: 0,
      lastRewriteAt: 0,
      lastRereadAt: 0,
      lastScrollTop: null
    };
  }

  function isVisible(node) {
    if (!node || !node.isConnected || node.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isEditable(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || !isVisible(node)) {
      return false;
    }
    if (node.matches('input, textarea')) {
      return !node.disabled && !node.readOnly && node.type !== 'password';
    }
    return node.isContentEditable || node.getAttribute('role') === 'textbox';
  }

  function findEditor(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const selector = currentSite ? currentSite.editorSelector : EDITOR_SELECTOR;
    const candidate = node.closest(selector);
    return isEditable(candidate) ? candidate : null;
  }

  function discoverEditors() {
    const selector = currentSite ? currentSite.editorSelector : EDITOR_SELECTOR;
    return Array.from(document.querySelectorAll(selector)).filter(isEditable);
  }

  function readDraft(editor) {
    if (!editor) {
      return '';
    }
    if (editor.matches('textarea, input')) {
      return editor.value || '';
    }
    return (editor.innerText || editor.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  function activateEditor(editor) {
    if (!editor) {
      return;
    }
    if (activeEditor !== editor) {
      activeEditor = editor;
      state = freshState();
      state.draft = readDraft(editor);
      state.previousDraft = state.draft;
      history = [];
    }
  }

  function touchActivity() {
    interacted = true;
    state.lastActivityAt = Date.now();
  }

  function commonPrefixLength(a, b) {
    const limit = Math.min(a.length, b.length);
    let index = 0;
    while (index < limit && a[index] === b[index]) {
      index += 1;
    }
    return index;
  }

  function isMajorRewrite(previous, current) {
    if (previous.length < 12 || previous === current) {
      return false;
    }
    const shortenedSubstantially = previous.length - current.length >= 8
      && current.length < previous.length * 0.45;
    const prefix = commonPrefixLength(previous, current);
    const replacedSubstantially = previous.length >= 20 && current.length >= 8
      && prefix < Math.min(previous.length, current.length) * 0.3;
    return shortenedSubstantially || replacedSubstantially;
  }

  function updateDraft(editor) {
    activateEditor(editor);
    const nextDraft = readDraft(editor);
    const now = Date.now();
    if (isMajorRewrite(state.previousDraft, nextDraft) && now - state.lastRewriteAt > 1200) {
      state.rewriteCount += 1;
      state.lastRewriteAt = now;
    }
    state.previousDraft = nextDraft;
    state.draft = nextDraft;
    touchActivity();
  }

  function cleanText(node) {
    return (node.innerText || node.textContent || '').trim();
  }

  function roleHint(node) {
    const attributes = [
      'data-message-author-role',
      'data-author-role',
      'data-role',
      'data-author',
      'aria-label',
      'class'
    ];
    const hint = attributes.map(function (name) {
      return node.getAttribute(name) || '';
    }).join(' ').toLowerCase();
    if (/assistant|chatbot|\bai\b|助手|Kimi/i.test(hint)) {
      return 'assistant';
    }
    if (/\buser\b|\bhuman\b|用户|提问者/.test(hint)) {
      return 'user';
    }
    return '';
  }

  function messageCandidates() {
    const selector = currentSite ? currentSite.messageSelector : MESSAGE_SELECTOR;
    return Array.from(document.querySelectorAll(selector)).filter(function (node) {
      return isVisible(node) && !node.contains(activeEditor) && cleanText(node).length > 0;
    }).filter(function (node, index, all) {
      return !all.some(function (other, otherIndex) {
        return otherIndex !== index && node.contains(other) && cleanText(other) === cleanText(node);
      });
    }).slice(-30);
  }

  function refreshContext() {
    if (activeEditor && !activeEditor.isConnected) {
      const editors = discoverEditors();
      activeEditor = editors.length ? editors[editors.length - 1] : null;
      interacted = false;
      state = freshState();
    }
    const candidates = messageCandidates();
    const messages = [];
    const now = Date.now();

    candidates.forEach(function (node, index) {
      const text = cleanText(node);
      if (!text || text.length > 50000) {
        return;
      }
      let role = roleHint(node);
      if (!role && candidates.length > 1) {
        role = (candidates.length - index) % 2 === 1 ? 'assistant' : 'user';
      } else if (!role && text.length >= 400) {
        role = 'assistant';
      }
      if (role) {
        messages.push({ node, role, text, timestamp: now });
      }
    });

    const recentUsers = messages.filter(function (message) {
      return message.role === 'user';
    }).slice(-8);
    userMessages = recentUsers.map(function (message, index) {
      return {
        id: message.node.getAttribute('data-message-id') || `user-${index + 1}`,
        text: message.text,
        timestamp: message.timestamp
      };
    });

    const assistants = messages.filter(function (message) {
      return message.role === 'assistant';
    });
    const lastAssistant = assistants[assistants.length - 1];
    lastAssistantLength = lastAssistant ? lastAssistant.text.length : 0;
    lastMessageRole = messages.length ? messages[messages.length - 1].role : '';
  }

  function buildFeatures(now) {
    const draft = activeEditor ? readDraft(activeEditor) : state.draft;
    const trimmed = draft.trim();
    const unfinishedSentence = trimmed.length >= 4 && !/[。！？!?…；;.:：]$/.test(trimmed);
    const unresolvedReference = trimmed.length > 0 && trimmed.length < 100
      && /(这个|那个|这些|那些|上述|前面提到的|刚才说的|它|他们|\bthis\b|\bthat\b|\bthese\b|\bthose\b)/i.test(trimmed);
    const longAnswerUncontinued = lastMessageRole === 'assistant'
      && lastAssistantLength >= 400
      && trimmed.length === 0
      && now - state.lastActivityAt >= 2000;

    return {
      pauseMs: interacted ? Math.max(0, now - state.lastActivityAt) : 0,
      backspaceRate: state.backspaces / Math.max(1, state.backspaces + state.inputEvents),
      rewriteCount: state.rewriteCount,
      rereadCount: state.rereadCount,
      unfinishedSentence,
      longAnswerUncontinued,
      unresolvedReference,
      draftLength: trimmed.length
    };
  }

  function tick() {
    if (!activeEditor || !interacted || suppressedForThisPage || window.SijiPopup.isOpen()) {
      return;
    }
    state.draft = readDraft(activeEditor);
    const now = Date.now();
    const result = engine.computeScore(buildFeatures(now), settings);
    history.push({ score: result.score, timestamp: now });
    history = history.slice(-40);

    if (!engine.shouldTrigger(result.score, now, lastPopupAt, settings)) {
      return;
    }
    lastPopupAt = now;
    chrome.storage.local.set({ sijiLastPopupAt: now });
    window.SijiPopup.show({
      score: result.score,
      reasons: result.reasons,
      history,
      settings
    }, {
      getHandoff() {
        const selection = window.getSelection();
        return {
          draft: readDraft(activeEditor),
          selectedText: selection ? selection.toString() : '',
          userMessages: userMessages.map(function (message) {
            return {
              id: message.id,
              text: message.text,
              timestamp: message.timestamp
            };
          })
        };
      },
      onClose(action) {
        if (action === 'suppress') {
          suppressedForThisPage = true;
        }
      }
    });
  }

  function onFocusIn(event) {
    const editor = findEditor(event.target);
    if (!editor) {
      return;
    }
    activateEditor(editor);
    updateDraft(editor);
  }

  function onFocusOut(event) {
    if (activeEditor && (event.target === activeEditor || activeEditor.contains(event.target))) {
      updateDraft(activeEditor);
    }
  }

  function onPointerDown(event) {
    const editor = findEditor(event.target);
    if (editor) {
      activateEditor(editor);
      updateDraft(editor);
    } else if (interacted) {
      touchActivity();
    }
  }

  function onKeyDown(event) {
    const editor = findEditor(event.target);
    if (!editor) {
      return;
    }
    activateEditor(editor);
    if (event.key === 'Backspace') {
      state.backspaces += 1;
    }
    touchActivity();
  }

  function onInput(event) {
    const editor = findEditor(event.target);
    if (!editor) {
      return;
    }
    updateDraft(editor);
    state.inputEvents += 1;
  }

  function onScroll(event) {
    if (!interacted || window.SijiPopup.isOpen()) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('#siji-context-overlay')) {
      return;
    }
    const target = event.target;
    const top = target === document || target === window
      ? window.scrollY
      : Number(target.scrollTop);
    if (!Number.isFinite(top)) {
      return;
    }
    const now = Date.now();
    if (state.lastScrollTop !== null && top < state.lastScrollTop - 24
      && now - state.lastRereadAt > 1000) {
      state.rereadCount += 1;
      state.lastRereadAt = now;
    }
    state.lastScrollTop = top;
    touchActivity();
  }

  function scheduleContextRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshContext, 350);
  }

  function startDetector(site) {
    currentSite = site;
    suppressedForThisPage = false;
    if (detectorStarted) return;
    detectorStarted = true;
    chrome.storage.local.get(['sijiSettings', 'sijiLastPopupAt'], function (stored) {
      if (chrome.runtime.lastError) {
        return;
      }
      settings = engine.normalizeSettings(Object.assign({}, settings, stored.sijiSettings || {}));
      lastPopupAt = Number.isFinite(stored.sijiLastPopupAt) ? stored.sijiLastPopupAt : null;
    });

    window.addEventListener('siji-settings-changed', function (event) {
      settings = engine.normalizeSettings(Object.assign({}, settings, event.detail || {}));
    });
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('scroll', onScroll, true);

    const observer = new MutationObserver(scheduleContextRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    refreshContext();
    setInterval(tick, 1000);
  }

  window.SijiSiteAdapters.whenReady(window.location, startDetector);
  window.addEventListener('siji-site-changed', function (event) {
    if (event.detail && event.detail.enabled) {
      window.SijiSiteAdapters.whenReady(window.location, startDetector);
    } else {
      suppressedForThisPage = true;
    }
  });
})();
