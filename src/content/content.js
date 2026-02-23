(function initJiraRelatedStepViewer() {
  if (window.__jrsvLoaded) {
    return;
  }
  window.__jrsvLoaded = true;

  const PANEL_ID = "jira-related-step-viewer";
  const LAUNCHER_ID = "jira-related-step-launcher";
  const PANEL_HIDDEN_CLASS = "jrsv-hidden";
  const BOT_ICON_SVG =
    '<svg class="jrsv-launcher-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="7" width="12" height="10" rx="3"></rect><circle cx="10" cy="12" r="1.4"></circle><circle cx="14" cy="12" r="1.4"></circle><path d="M9 15h6"></path><path d="M12 4v3"></path><path d="M8 7 7 6"></path><path d="m16 7 1-1"></path></svg>';
  const CLOSE_ICON_SVG =
    '<svg class="jrsv-launcher-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 18 18"></path><path d="M18 6 6 18"></path></svg>';
  const JIRA_AVATAR_URL = chrome.runtime.getURL("icons/jira.svg");
  const STORAGE_KEY = "jrsv.settings";
  const CHAT_HISTORY_KEY = "jrsv.chatHistoryByIssue.v1";
  const CHAT_GLOBAL_ROOM = "GLOBAL";
  const CHAT_MAX_MESSAGES = 120;
  const MAX_ALERT_ITEMS = 20;
  const MAX_RECOMMENDED_ITEMS = 6;
  const DEFAULT_SETTINGS = Object.freeze({
    productLabelPrefix: "product:",
    stepLabelPrefix: "step:",
    stepRegex: "(?:^|\\s)step[:\\-_ ]?(\\d+)",
    maxRelatedIssues: 50,
    productFieldId: "",
    stepFieldId: "",
    linkTypeFilter: "",
    localBridgeEnabled: false,
    localBridgeUrl: "http://localhost:4096/api/chat",
    localBridgeTimeoutMs: 8000
  });
  const SCRUM_PRESET = Object.freeze({
    hostname: "dhwoo.atlassian.net",
    projectKey: "SCRUM",
    settings: {
      productLabelPrefix: "product:",
      stepLabelPrefix: "step:",
      stepRegex: "(?:^|\\s)step[:\\-_ ]?(\\d+)",
      maxRelatedIssues: 80,
      productFieldId: "",
      stepFieldId: "",
      linkTypeFilter: "Relates",
      localBridgeEnabled: true,
      localBridgeUrl: "http://localhost:4096/api/chat",
      localBridgeTimeoutMs: 8000
    }
  });

  const state = {
    launcher: null,
    panel: null,
    body: null,
    subtitle: null,
    messages: null,
    composerInput: null,
    quickActionWrap: null,
    dataMessageBody: null,
    tabBar: null,
    chatTabButton: null,
    alertsTabButton: null,
    chatPane: null,
    alertsPane: null,
    alertsListNode: null,
    alertsEmptyNode: null,
    alertsUnreadFilterButton: null,
    alertUnreadOnly: false,
    alertItems: [],
    unreadAlertCount: 0,
    recommendedItems: [],
    stepFlow: [],
    stepCursor: 0,
    stepResults: {},
    currentIssue: null,
    settings: { ...DEFAULT_SETTINGS },
    bridgeFailureNotified: false,
    chatHistoryByRoom: {},
    activeChatRoom: CHAT_GLOBAL_ROOM,
    chatHistoryReady: false,
    chatSaveTimer: null,
    activeTab: "chat",
    isOpen: false,
    activeIssueKey: null,
    lastKnownHref: window.location.href,
    loadingToken: 0
  };

  function storageGet(key) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync) {
        resolve(undefined);
        return;
      }
      chrome.storage.sync.get(key, (result) => {
        if (chrome.runtime?.lastError) {
          resolve(undefined);
          return;
        }
        resolve(result[key]);
      });
    });
  }

  function storageLocalGet(key) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve(undefined);
        return;
      }
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime?.lastError) {
          resolve(undefined);
          return;
        }
        resolve(result[key]);
      });
    });
  }

  function storageLocalSet(value) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set(value, () => {
        resolve();
      });
    });
  }

  function getChatRoom(issueKey) {
    return issueKey ? `ISSUE:${issueKey}` : CHAT_GLOBAL_ROOM;
  }

  function getCurrentChatRoom() {
    return state.activeChatRoom || CHAT_GLOBAL_ROOM;
  }

  function scheduleChatHistorySave() {
    if (state.chatSaveTimer) {
      window.clearTimeout(state.chatSaveTimer);
    }
    state.chatSaveTimer = window.setTimeout(() => {
      state.chatSaveTimer = null;
      void storageLocalSet({
        [CHAT_HISTORY_KEY]: state.chatHistoryByRoom
      });
    }, 260);
  }

  function persistChatMessage(role, text) {
    if (!text) {
      return;
    }
    const room = getCurrentChatRoom();
    if (!state.chatHistoryByRoom[room]) {
      state.chatHistoryByRoom[room] = [];
    }
    state.chatHistoryByRoom[room].push({
      role: role === "user" ? "user" : "bot",
      text: String(text),
      ts: Date.now()
    });
    state.chatHistoryByRoom[room] = state.chatHistoryByRoom[room].slice(-CHAT_MAX_MESSAGES);
    scheduleChatHistorySave();
  }

  function renderChatHistoryForRoom(room) {
    if (!state.messages) {
      return;
    }
    state.messages.innerHTML = "";
    state.dataMessageBody = null;

    const history = Array.isArray(state.chatHistoryByRoom[room]) ? state.chatHistoryByRoom[room] : [];
    if (history.length === 0) {
      appendChatMessage(
        "bot",
        "안녕하세요. AES Jira Bot입니다. 현재 이슈 분석, 관련 기능 이슈 추천, 알림 확인을 도와드릴게요.",
        { persist: true, scroll: false }
      );
      appendChatMessage(
        "bot",
        "바로 사용하려면 `추천 이슈 보여줘`, `알림 보여줘`, `새로고침` 중 하나를 입력해 보세요.",
        { persist: true, scroll: false }
      );
    } else {
      for (const item of history) {
        appendChatMessage(item.role || "bot", item.text || "", { persist: false, scroll: false });
      }
    }

    ensureDataMessageBody();
    state.messages.scrollTop = state.messages.scrollHeight;
  }

  function switchChatRoom(issueKey) {
    const room = getChatRoom(issueKey);
    if (!state.chatHistoryReady || !state.messages) {
      state.activeChatRoom = room;
      return;
    }
    if (state.activeChatRoom === room && state.messages.childElementCount > 0) {
      return;
    }
    state.activeChatRoom = room;
    renderChatHistoryForRoom(room);
  }

  async function initializeChatHistory() {
    const stored = await storageLocalGet(CHAT_HISTORY_KEY);
    state.chatHistoryByRoom = stored && typeof stored === "object" ? stored : {};
    state.chatHistoryReady = true;
    switchChatRoom(extractIssueKey(window.location.href));
  }

  function getPresetSettings(issueKey) {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname !== SCRUM_PRESET.hostname) {
      return null;
    }
    if (!issueKey || !issueKey.startsWith(`${SCRUM_PRESET.projectKey}-`)) {
      return null;
    }
    return SCRUM_PRESET.settings;
  }

  async function loadSettings(issueKey) {
    const stored = await storageGet(STORAGE_KEY);
    const preset = getPresetSettings(issueKey);
    const merged = { ...DEFAULT_SETTINGS, ...(preset || {}), ...(stored || {}) };
    merged.maxRelatedIssues = Number.parseInt(merged.maxRelatedIssues, 10);
    if (!Number.isFinite(merged.maxRelatedIssues) || merged.maxRelatedIssues < 1) {
      merged.maxRelatedIssues = DEFAULT_SETTINGS.maxRelatedIssues;
    }
    merged.localBridgeEnabled = Boolean(merged.localBridgeEnabled);
    merged.localBridgeUrl = String(merged.localBridgeUrl || DEFAULT_SETTINGS.localBridgeUrl).trim();
    merged.localBridgeTimeoutMs = Number.parseInt(merged.localBridgeTimeoutMs, 10);
    if (!Number.isFinite(merged.localBridgeTimeoutMs) || merged.localBridgeTimeoutMs < 500) {
      merged.localBridgeTimeoutMs = DEFAULT_SETTINGS.localBridgeTimeoutMs;
    }
    merged.localBridgeTimeoutMs = Math.min(20_000, merged.localBridgeTimeoutMs);
    return merged;
  }

  function extractIssueKey(urlText) {
    const match = String(urlText).match(/\/browse\/([A-Z][A-Z0-9]+-\d+)(?:[/?#]|$)/i);
    return match ? match[1].toUpperCase() : null;
  }

  function setPanelOpen(open) {
    if (!state.panel) {
      return;
    }
    state.isOpen = !!open;
    state.panel.classList.toggle(PANEL_HIDDEN_CLASS, !state.isOpen);
    if (state.launcher) {
      state.launcher.classList.toggle("jrsv-active", state.isOpen);
      state.launcher.innerHTML = state.isOpen ? CLOSE_ICON_SVG : BOT_ICON_SVG;
      state.launcher.title = state.isOpen ? "AES Jira Bot 닫기" : "AES Jira Bot 열기";
      state.launcher.setAttribute(
        "aria-label",
        state.isOpen ? "AES Jira Bot 닫기" : "AES Jira Bot 열기"
      );
    }
    if (state.isOpen && state.composerInput) {
      state.composerInput.focus();
    }
  }

  function createLauncher() {
    if (state.launcher && state.launcher.isConnected) {
      return;
    }

    const launcher = document.createElement("button");
    launcher.id = LAUNCHER_ID;
    launcher.type = "button";
    launcher.innerHTML = BOT_ICON_SVG;
    launcher.title = "AES Jira Bot 열기";
    launcher.setAttribute("aria-label", "AES Jira Bot 열기");
    launcher.addEventListener("click", () => {
      setPanelOpen(!state.isOpen);
      if (state.isOpen) {
        void refreshForCurrentUrl(false);
      }
    });

    document.body.appendChild(launcher);
    state.launcher = launcher;
  }

  function createPanel() {
    if (state.panel && state.panel.isConnected) {
      return;
    }

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.classList.add(PANEL_HIDDEN_CLASS);

    const header = document.createElement("div");
    header.className = "jrsv-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "jrsv-title";
    title.textContent = "AES Jira Bot";
    const subtitle = document.createElement("div");
    subtitle.className = "jrsv-subtitle";
    subtitle.textContent = "이슈를 열면 관련 정보를 분석해요";

    const tabBar = document.createElement("div");
    tabBar.className = "jrsv-tabbar";

    const chatTabButton = document.createElement("button");
    chatTabButton.type = "button";
    chatTabButton.className = "jrsv-tab-btn jrsv-tab-active";
    chatTabButton.textContent = "채팅";

    const alertsTabButton = document.createElement("button");
    alertsTabButton.type = "button";
    alertsTabButton.className = "jrsv-tab-btn";
    alertsTabButton.textContent = "알림";

    tabBar.appendChild(chatTabButton);
    tabBar.appendChild(alertsTabButton);

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    titleWrap.appendChild(tabBar);

    const actions = document.createElement("div");
    actions.className = "jrsv-actions";

    const refreshButton = document.createElement("button");
    refreshButton.className = "jrsv-btn";
    refreshButton.type = "button";
    refreshButton.textContent = "새로고침";
    refreshButton.addEventListener("click", () => {
      void refreshForCurrentUrl(true);
    });

    const closeButton = document.createElement("button");
    closeButton.className = "jrsv-btn";
    closeButton.type = "button";
    closeButton.textContent = "X";
    closeButton.title = "닫기";
    closeButton.addEventListener("click", () => {
      setPanelOpen(false);
    });

    actions.appendChild(refreshButton);
    actions.appendChild(closeButton);

    header.appendChild(titleWrap);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "jrsv-body";

    const panesWrap = document.createElement("div");
    panesWrap.className = "jrsv-panes";

    const chatPane = document.createElement("div");
    chatPane.className = "jrsv-pane jrsv-chat-pane";

    const messages = document.createElement("div");
    messages.className = "jrsv-chat-log";

    const composer = document.createElement("form");
    composer.className = "jrsv-composer";
    composer.autocomplete = "off";

    const input = document.createElement("input");
    input.className = "jrsv-input";
    input.type = "text";
    input.placeholder = "무엇을 도와줄까요? (예: 추천 이슈 보여줘)";

    const sendButton = document.createElement("button");
    sendButton.className = "jrsv-send";
    sendButton.type = "submit";
    sendButton.textContent = "전송";

    const quickActionWrap = document.createElement("div");
    quickActionWrap.className = "jrsv-quick-actions";

    const quickActions = [
      { label: "관련 이슈", action: () => void refreshForCurrentUrl(true) },
      { label: "추천 이슈", action: () => void handleUserPrompt("추천 이슈 보여줘", true) },
      { label: "알림 보기", action: () => void handleUserPrompt("알림 보여줘", true) },
      { label: "PASS", action: () => void handleUserPrompt("pass", true) },
      { label: "FAIL", action: () => void handleUserPrompt("fail", true) },
      { label: "다음 Step", action: () => void handleUserPrompt("다음 step", true) },
      { label: "도움말", action: () => void handleUserPrompt("도움말", true) }
    ];

    for (const item of quickActions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "jrsv-quick-btn";
      button.textContent = item.label;
      button.addEventListener("click", item.action);
      quickActionWrap.appendChild(button);
    }

    composer.appendChild(input);
    composer.appendChild(sendButton);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) {
        return;
      }
      input.value = "";
      void handleUserPrompt(text);
    });

    chatPane.appendChild(messages);
    chatPane.appendChild(quickActionWrap);
    chatPane.appendChild(composer);

    const alertsPane = document.createElement("div");
    alertsPane.className = "jrsv-pane jrsv-alerts-pane jrsv-pane-hidden";

    const alertsToolbar = document.createElement("div");
    alertsToolbar.className = "jrsv-alerts-toolbar";

    const markAllReadButton = document.createElement("button");
    markAllReadButton.type = "button";
    markAllReadButton.className = "jrsv-mini-btn";
    markAllReadButton.textContent = "모두 확인";

    const clearReadButton = document.createElement("button");
    clearReadButton.type = "button";
    clearReadButton.className = "jrsv-mini-btn";
    clearReadButton.textContent = "확인한 알림 지우기";

    const refreshAlertsButton = document.createElement("button");
    refreshAlertsButton.type = "button";
    refreshAlertsButton.className = "jrsv-mini-btn";
    refreshAlertsButton.textContent = "새 알림 확인";

    const unreadOnlyButton = document.createElement("button");
    unreadOnlyButton.type = "button";
    unreadOnlyButton.className = "jrsv-mini-btn";
    unreadOnlyButton.textContent = "미확인만";

    alertsToolbar.appendChild(markAllReadButton);
    alertsToolbar.appendChild(clearReadButton);
    alertsToolbar.appendChild(refreshAlertsButton);
    alertsToolbar.appendChild(unreadOnlyButton);

    const alertsListNode = document.createElement("div");
    alertsListNode.className = "jrsv-alerts-list";

    const alertsEmptyNode = document.createElement("div");
    alertsEmptyNode.className = "jrsv-state";
    alertsEmptyNode.textContent = "알림이 없습니다.";
    alertsListNode.appendChild(alertsEmptyNode);

    alertsPane.appendChild(alertsToolbar);
    alertsPane.appendChild(alertsListNode);

    panesWrap.appendChild(chatPane);
    panesWrap.appendChild(alertsPane);

    body.appendChild(panesWrap);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    state.panel = panel;
    state.body = body;
    state.subtitle = subtitle;
    state.tabBar = tabBar;
    state.chatTabButton = chatTabButton;
    state.alertsTabButton = alertsTabButton;
    state.chatPane = chatPane;
    state.alertsPane = alertsPane;
    state.alertsListNode = alertsListNode;
    state.alertsEmptyNode = alertsEmptyNode;
    state.alertsUnreadFilterButton = unreadOnlyButton;
    state.messages = messages;
    state.composerInput = input;
    state.quickActionWrap = quickActionWrap;
    state.dataMessageBody = null;

    chatTabButton.addEventListener("click", () => {
      setActiveTab("chat");
    });
    alertsTabButton.addEventListener("click", () => {
      setActiveTab("alerts");
    });
    markAllReadButton.addEventListener("click", () => {
      void markAllAlertsRead();
    });
    clearReadButton.addEventListener("click", () => {
      void deleteReadAlerts();
    });
    refreshAlertsButton.addEventListener("click", () => {
      void pollAlertsNow();
    });
    unreadOnlyButton.addEventListener("click", () => {
      state.alertUnreadOnly = !state.alertUnreadOnly;
      unreadOnlyButton.classList.toggle("jrsv-mini-btn-active", state.alertUnreadOnly);
      renderAlertsTab();
    });
    updateAlertsTabBadge();
    setActiveTab("chat");
    void initializeChatHistory();
  }

  function setSubtitle(text) {
    if (state.subtitle) {
      state.subtitle.textContent = text;
    }
  }

  function createBotAvatarNode() {
    const avatar = document.createElement("div");
    avatar.className = "jrsv-avatar";
    const img = document.createElement("img");
    img.className = "jrsv-avatar-image";
    img.src = JIRA_AVATAR_URL;
    img.alt = "Jira";
    avatar.appendChild(img);
    return avatar;
  }

  function updateAlertsTabBadge() {
    if (!state.alertsTabButton) {
      return;
    }
    const unread = Number.isFinite(state.unreadAlertCount) ? state.unreadAlertCount : 0;
    state.alertsTabButton.textContent = "알림";
    if (unread > 0) {
      const badge = document.createElement("span");
      badge.className = "jrsv-tab-badge";
      badge.textContent = unread > 99 ? "99+" : String(unread);
      state.alertsTabButton.appendChild(badge);
    }
  }

  function setActiveTab(tab) {
    state.activeTab = tab === "alerts" ? "alerts" : "chat";
    if (state.chatTabButton) {
      state.chatTabButton.classList.toggle("jrsv-tab-active", state.activeTab === "chat");
    }
    if (state.alertsTabButton) {
      state.alertsTabButton.classList.toggle("jrsv-tab-active", state.activeTab === "alerts");
    }
    if (state.chatPane) {
      state.chatPane.classList.toggle("jrsv-pane-hidden", state.activeTab !== "chat");
    }
    if (state.alertsPane) {
      state.alertsPane.classList.toggle("jrsv-pane-hidden", state.activeTab !== "alerts");
    }
    if (state.activeTab === "alerts") {
      renderAlertsTab();
      void syncAlertInbox();
    }
  }

  function appendChatMessage(role, text, options) {
    if (!state.messages) {
      return null;
    }
    const persist = options?.persist !== false;
    const scroll = options?.scroll !== false;
    const row = document.createElement("div");
    row.className = `jrsv-msg jrsv-msg-${role}`;

    if (role === "bot") {
      row.appendChild(createBotAvatarNode());
    }

    const bubble = document.createElement("div");
    bubble.className = "jrsv-msg-bubble";
    bubble.textContent = text;

    row.appendChild(bubble);
    state.messages.appendChild(row);
    if (persist) {
      persistChatMessage(role, text);
    }
    if (scroll) {
      state.messages.scrollTop = state.messages.scrollHeight;
    }
    return bubble;
  }

  function ensureDataMessageBody() {
    if (state.dataMessageBody && state.dataMessageBody.isConnected) {
      return state.dataMessageBody;
    }
    if (!state.messages) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "jrsv-msg jrsv-msg-bot jrsv-msg-data";
    const avatar = createBotAvatarNode();
    const bubble = document.createElement("div");
    bubble.className = "jrsv-msg-bubble";
    bubble.textContent = "아직 분석 데이터가 없습니다.";
    row.appendChild(avatar);
    row.appendChild(bubble);
    state.messages.appendChild(row);

    state.dataMessageBody = bubble;
    state.messages.scrollTop = state.messages.scrollHeight;
    return bubble;
  }

  function setDataMessageContent(content, error) {
    const bubble = ensureDataMessageBody();
    if (!bubble) {
      return;
    }

    bubble.innerHTML = "";
    bubble.classList.toggle("jrsv-error", !!error);

    if (typeof content === "string") {
      const node = document.createElement("div");
      node.className = `jrsv-state${error ? " jrsv-error" : ""}`;
      node.textContent = content;
      bubble.appendChild(node);
      state.messages.scrollTop = state.messages.scrollHeight;
      return;
    }

    bubble.appendChild(content);
    state.messages.scrollTop = state.messages.scrollHeight;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      if (!chrome?.runtime?.sendMessage) {
        resolve(null);
        return;
      }
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(null);
      }, 5000);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(null);
      }
    });
  }

  function escapeRegExp(raw) {
    return String(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeText(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenizeSummary(summary) {
    const normalized = normalizeText(summary);
    if (!normalized) {
      return [];
    }
    const stopWords = new Set([
      "the",
      "and",
      "for",
      "with",
      "from",
      "this",
      "that",
      "step",
      "test",
      "issue",
      "jira",
      "기능",
      "이슈",
      "관련",
      "수정",
      "추가",
      "화면",
      "버튼",
      "처리"
    ]);
    const tokens = normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopWords.has(token));
    return [...new Set(tokens)].slice(0, 6);
  }

  function makeJqlList(values) {
    return values
      .map((value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join(",");
  }

  function formatRelativeTime(isoText) {
    const target = new Date(isoText || "");
    if (Number.isNaN(target.getTime())) {
      return "";
    }
    const diffMin = Math.floor((Date.now() - target.getTime()) / 60_000);
    if (diffMin < 1) {
      return "방금 전";
    }
    if (diffMin < 60) {
      return `${diffMin}분 전`;
    }
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) {
      return `${diffHour}시간 전`;
    }
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}일 전`;
  }

  function createSectionTitle(text) {
    const title = document.createElement("div");
    title.className = "jrsv-section-title";
    title.textContent = text;
    return title;
  }

  function updateAlertCache(items) {
    if (!Array.isArray(items)) {
      return;
    }
    const existingById = new Map(state.alertItems.map((item) => [item.id, item]));
    for (const item of items) {
      if (!item?.id) {
        continue;
      }
      const existing = existingById.get(item.id);
      existingById.set(item.id, {
        ...existing,
        ...item,
        isRead: item.isRead != null ? Boolean(item.isRead) : Boolean(existing?.isRead)
      });
    }
    state.alertItems = [...existingById.values()]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, MAX_ALERT_ITEMS);
    state.unreadAlertCount = state.alertItems.filter((item) => !item.isRead).length;
    updateAlertsTabBadge();
  }

  function createAlertListNode(alertItems) {
    const wrap = document.createElement("div");
    wrap.className = "jrsv-alert-list";

    if (!alertItems.length) {
      const empty = document.createElement("div");
      empty.className = "jrsv-state";
      empty.textContent = "최근 알림이 없습니다.";
      wrap.appendChild(empty);
      return wrap;
    }

    const list = document.createElement("ul");
    list.className = "jrsv-issues";
    for (const item of alertItems.slice(0, 8)) {
      const li = document.createElement("li");
      li.className = `jrsv-issue${item.isRead ? " jrsv-issue-read" : ""}`;

      const left = document.createElement("div");
      const link = document.createElement("a");
      link.className = "jrsv-issue-link";
      link.href = item.link || `${window.location.origin}/browse/${item.key}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.key || "UNKNOWN";

      const summary = document.createElement("span");
      summary.className = "jrsv-issue-summary";
      summary.textContent = item.summary ? ` ${item.summary}` : "";

      left.appendChild(link);
      left.appendChild(summary);

      const status = document.createElement("div");
      status.className = "jrsv-issue-status";
      status.textContent = item.updatedLabel || formatRelativeTime(item.updated);

      li.appendChild(left);
      li.appendChild(status);
      list.appendChild(li);
    }

    wrap.appendChild(list);
    return wrap;
  }

  function renderAlertsTab() {
    if (!state.alertsListNode) {
      return;
    }
    state.alertsListNode.innerHTML = "";
    const visibleItems = state.alertUnreadOnly
      ? state.alertItems.filter((item) => !item.isRead)
      : state.alertItems;

    if (!visibleItems.length) {
      const empty = document.createElement("div");
      empty.className = "jrsv-state";
      empty.textContent = state.alertUnreadOnly ? "미확인 알림이 없습니다." : "알림이 없습니다.";
      state.alertsListNode.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "jrsv-alert-tab-list";

    for (const item of visibleItems) {
      const row = document.createElement("li");
      row.className = `jrsv-alert-tab-item${item.isRead ? " jrsv-alert-read" : ""}`;

      const left = document.createElement("div");
      left.className = "jrsv-alert-main";

      const top = document.createElement("div");
      top.className = "jrsv-alert-top";

      const link = document.createElement("a");
      link.className = "jrsv-issue-link";
      link.href = item.link || `${window.location.origin}/browse/${item.key}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.key || "UNKNOWN";
      link.addEventListener("click", () => {
        if (!item.isRead) {
          void markAlertRead(item.id, true);
        }
      });

      const time = document.createElement("span");
      time.className = "jrsv-alert-time";
      time.textContent = item.updatedLabel || formatRelativeTime(item.updated);

      top.appendChild(link);
      top.appendChild(time);

      const summary = document.createElement("div");
      summary.className = "jrsv-alert-summary";
      summary.textContent = item.summary || "(요약 없음)";

      left.appendChild(top);
      left.appendChild(summary);

      const actions = document.createElement("div");
      actions.className = "jrsv-alert-actions";

      const toggleRead = document.createElement("button");
      toggleRead.type = "button";
      toggleRead.className = "jrsv-mini-btn";
      toggleRead.textContent = item.isRead ? "미확인" : "확인";
      toggleRead.addEventListener("click", () => {
        void markAlertRead(item.id, !item.isRead);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "jrsv-mini-btn jrsv-danger";
      remove.textContent = "삭제";
      remove.addEventListener("click", () => {
        void deleteAlert(item.id);
      });

      actions.appendChild(toggleRead);
      actions.appendChild(remove);

      row.appendChild(left);
      row.appendChild(actions);
      list.appendChild(row);
    }

    state.alertsListNode.appendChild(list);
  }

  function createRecommendedListNode(items) {
    const wrap = document.createElement("div");
    wrap.className = "jrsv-reco-list";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "jrsv-state";
      empty.textContent = "추천 가능한 유사 기능 이슈를 찾지 못했습니다.";
      wrap.appendChild(empty);
      return wrap;
    }

    const list = document.createElement("ul");
    list.className = "jrsv-issues";

    for (const item of items.slice(0, MAX_RECOMMENDED_ITEMS)) {
      const li = document.createElement("li");
      li.className = "jrsv-issue";

      const left = document.createElement("div");
      const link = document.createElement("a");
      link.className = "jrsv-issue-link";
      link.href = `${window.location.origin}/browse/${item.key}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.key;

      const summary = document.createElement("span");
      summary.className = "jrsv-issue-summary";
      summary.textContent = ` ${item.fields?.summary || ""}`;

      const reason = document.createElement("div");
      reason.className = "jrsv-reco-reason";
      reason.textContent = `추천 근거: ${item.reasonText || "유사한 속성"}`;

      left.appendChild(link);
      left.appendChild(summary);
      left.appendChild(reason);

      const status = document.createElement("div");
      status.className = "jrsv-issue-status";
      status.textContent = `${item.score || 0}점`;

      li.appendChild(left);
      li.appendChild(status);
      list.appendChild(li);
    }

    wrap.appendChild(list);
    return wrap;
  }

  async function syncAlertInbox() {
    const response = await sendRuntimeMessage({ type: "jrsv:getAlertInbox" });
    const items = Array.isArray(response?.items) ? response.items : [];
    updateAlertCache(items);
    if (Number.isFinite(response?.unreadCount)) {
      state.unreadAlertCount = response.unreadCount;
      updateAlertsTabBadge();
    }
    if (state.activeTab === "alerts") {
      renderAlertsTab();
    }
    return state.alertItems;
  }

  function applyAlertInboxResponse(response) {
    const items = Array.isArray(response?.items) ? response.items : [];
    updateAlertCache(items);
    if (Number.isFinite(response?.unreadCount)) {
      state.unreadAlertCount = response.unreadCount;
      updateAlertsTabBadge();
    }
    renderAlertsTab();
  }

  async function mutateAlertInbox(message) {
    const response = await sendRuntimeMessage(message);
    if (!response?.ok) {
      return false;
    }
    applyAlertInboxResponse(response);
    return true;
  }

  async function markAlertRead(alertId, isRead) {
    await mutateAlertInbox({
      type: "jrsv:markAlertRead",
      id: alertId,
      isRead
    });
  }

  async function deleteAlert(alertId) {
    await mutateAlertInbox({
      type: "jrsv:deleteAlert",
      id: alertId
    });
  }

  async function markAllAlertsRead() {
    const ok = await mutateAlertInbox({
      type: "jrsv:markAllAlertsRead"
    });
    if (ok) {
      appendChatMessage("bot", "모든 알림을 확인 처리했어요.");
    }
  }

  async function deleteReadAlerts() {
    const ok = await mutateAlertInbox({
      type: "jrsv:deleteReadAlerts"
    });
    if (ok) {
      appendChatMessage("bot", "확인한 알림을 정리했어요.");
    }
  }

  async function pollAlertsNow() {
    const response = await sendRuntimeMessage({ type: "jrsv:pollNow" });
    if (response?.ok) {
      if (Array.isArray(response.newItems) && response.newItems.length > 0) {
        updateAlertCache(response.newItems);
      }
      await syncAlertInbox();
      appendChatMessage("bot", `새 알림 확인 완료: ${response.newCount || 0}건`);
    } else {
      appendChatMessage("bot", `알림 확인 실패: ${response?.error || "오류"}`);
    }
  }

  async function fetchRecommendedIssues(baseIssue) {
    const baseKey = baseIssue?.key;
    if (!baseKey) {
      return [];
    }

    const labels = (baseIssue?.fields?.labels || []).slice(0, 8);
    const componentNames = (baseIssue?.fields?.components || [])
      .map((item) => item?.name)
      .filter(Boolean)
      .slice(0, 6);
    const summaryTokens = tokenizeSummary(baseIssue?.fields?.summary || "");

    const clauses = [];
    if (labels.length > 0) {
      clauses.push(`labels in (${makeJqlList(labels)})`);
    }
    if (componentNames.length > 0) {
      clauses.push(`component in (${makeJqlList(componentNames)})`);
    }
    if (summaryTokens.length > 0) {
      clauses.push(summaryTokens.map((token) => `summary ~ "${token}"`).join(" OR "));
    }

    const jqlCore = clauses.length > 0 ? `(${clauses.join(" OR ")})` : "updated >= -90d";
    const jql = [`key != "${baseKey}"`, `AND ${jqlCore}`, "AND updated >= -180d", "ORDER BY updated DESC"].join(" ");

    const endpoint = new URL("/rest/api/3/search", window.location.origin);
    endpoint.searchParams.set("jql", jql);
    endpoint.searchParams.set("maxResults", "35");
    endpoint.searchParams.set("fields", "summary,status,labels,components,updated");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return [];
    }

    const json = await response.json();
    const issues = Array.isArray(json?.issues) ? json.issues : [];
    const baseLabelSet = new Set(labels.map((item) => item.toLowerCase()));
    const baseComponentSet = new Set(componentNames.map((item) => item.toLowerCase()));
    const scored = [];
    for (const issue of issues) {
      const issueLabels = (issue?.fields?.labels || []).map((item) => String(item).toLowerCase());
      const issueComponents = (issue?.fields?.components || [])
        .map((item) => String(item?.name || "").toLowerCase())
        .filter(Boolean);
      const issueSummary = normalizeText(issue?.fields?.summary || "");

      let score = 0;
      const reasons = [];

      const commonLabels = issueLabels.filter((item) => baseLabelSet.has(item));
      if (commonLabels.length > 0) {
        score += commonLabels.length * 3;
        reasons.push(`라벨 ${commonLabels.slice(0, 2).join(", ")}`);
      }

      const commonComponents = issueComponents.filter((item) => baseComponentSet.has(item));
      if (commonComponents.length > 0) {
        score += commonComponents.length * 2;
        reasons.push(`컴포넌트 ${commonComponents.slice(0, 2).join(", ")}`);
      }

      let tokenMatches = 0;
      for (const token of summaryTokens) {
        const tokenRe = new RegExp(escapeRegExp(token), "i");
        if (tokenRe.test(issueSummary)) {
          tokenMatches += 1;
        }
      }
      if (tokenMatches > 0) {
        score += Math.min(3, tokenMatches);
        reasons.push(`요약 키워드 ${tokenMatches}개`);
      }

      if (score > 0) {
        scored.push({
          ...issue,
          score,
          reasonText: reasons.join(" + ")
        });
      }
    }

    return scored
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return String(b?.fields?.updated || "").localeCompare(String(a?.fields?.updated || ""));
      })
      .slice(0, MAX_RECOMMENDED_ITEMS);
  }

  async function showAlertListMessage() {
    await syncAlertInbox();
    if (state.alertItems.length === 0) {
      appendChatMessage("bot", "현재 확인할 알림이 없습니다.");
      return;
    }
    const bubble = appendChatMessage("bot", "최근 Jira 알림이에요.");
    if (!bubble) {
      return;
    }
    bubble.appendChild(createAlertListNode(state.alertItems));
  }

  function extractProjectFromKey(issueKey) {
    if (!issueKey || typeof issueKey !== "string") {
      return "";
    }
    const idx = issueKey.indexOf("-");
    return idx > 0 ? issueKey.slice(0, idx).toUpperCase() : "";
  }

  function setStepFlowFromGroups(groups) {
    const flow = [];
    for (const product of groups || []) {
      for (const step of product.steps || []) {
        flow.push({
          id: `${product.name}:${step.id}`,
          product: product.name,
          title: step.title,
          order: step.order,
          issues: step.issues || []
        });
      }
    }
    state.stepFlow = flow;
    state.stepCursor = 0;
    state.stepResults = {};
  }

  function getCurrentStepInfo() {
    if (!Array.isArray(state.stepFlow) || state.stepFlow.length === 0) {
      return null;
    }
    return state.stepFlow[state.stepCursor] || null;
  }

  function formatIssueKeyList(issues, maxCount) {
    const keys = (issues || [])
      .map((item) => item?.key)
      .filter(Boolean)
      .slice(0, maxCount || 4);
    return keys.join(", ");
  }

  function pickStepRecommendations(step) {
    if (!step) {
      return { sameProject: [], crossProject: [] };
    }
    const baseProject = extractProjectFromKey(state.activeIssueKey);
    const tokens = tokenizeSummary(`${step.title} ${(step.issues || []).map((item) => item.fields?.summary || "").join(" ")}`);

    const scored = [];
    for (const issue of state.recommendedItems || []) {
      const summary = normalizeText(issue?.fields?.summary || "");
      let score = issue?.score || 0;
      for (const token of tokens) {
        if (summary.includes(token)) {
          score += 2;
        }
      }
      if (score > 0) {
        scored.push({ issue, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const sameProject = [];
    const crossProject = [];
    for (const item of scored) {
      const project = extractProjectFromKey(item.issue?.key);
      if (project && project === baseProject) {
        sameProject.push(item.issue);
      } else {
        crossProject.push(item.issue);
      }
    }
    return {
      sameProject: sameProject.slice(0, 3),
      crossProject: crossProject.slice(0, 3)
    };
  }

  function buildStepGuidanceText(step, prefixText) {
    if (!step) {
      return "진행할 단계가 없습니다.";
    }

    const recommendations = pickStepRecommendations(step);
    const lines = [];
    if (prefixText) {
      lines.push(prefixText);
    }
    lines.push(`현재 단계: ${step.title} (${step.product})`);

    if ((step.issues || []).length > 0) {
      lines.push(`기존 연결 이슈: ${formatIssueKeyList(step.issues, 5)}`);
    } else {
      lines.push("연결된 이슈는 아직 없습니다.");
    }

    if (recommendations.sameProject.length > 0) {
      lines.push(`이전에 비슷한 이슈: ${formatIssueKeyList(recommendations.sameProject, 3)}`);
    }
    if (recommendations.crossProject.length > 0) {
      lines.push(`다른 테스트/프로젝트 유사 이슈: ${formatIssueKeyList(recommendations.crossProject, 3)}`);
    }

    lines.push("재현 제안: 이 단계의 연결 이슈 요약을 순서대로 확인하면서 동일한 입력/조건으로 재현해 보세요.");
    return lines.join("\n");
  }

  function announceCurrentStep(prefixText) {
    const step = getCurrentStepInfo();
    if (!step) {
      return;
    }
    appendChatMessage("bot", buildStepGuidanceText(step, prefixText));
  }

  function moveToNextStep() {
    if (!Array.isArray(state.stepFlow) || state.stepFlow.length === 0) {
      return false;
    }
    if (state.stepCursor >= state.stepFlow.length - 1) {
      return false;
    }
    state.stepCursor += 1;
    return true;
  }

  function summarizeStepResults() {
    const values = Object.values(state.stepResults || {});
    const passCount = values.filter((item) => item === "pass").length;
    const failCount = values.filter((item) => item === "fail").length;
    return `진행 완료: PASS ${passCount}건, FAIL ${failCount}건`;
  }

  function handleStepDecision(decision) {
    const step = getCurrentStepInfo();
    if (!step) {
      appendChatMessage("bot", "현재 진행 가능한 단계가 없습니다. 먼저 이슈를 새로고침해 주세요.");
      return;
    }

    state.stepResults[step.id] = decision;
    const nextExists = moveToNextStep();
    if (nextExists) {
      announceCurrentStep(`${step.title}를 ${decision.toUpperCase()}로 기록했어요. 다음 단계로 이동합니다.`);
      return;
    }

    appendChatMessage(
      "bot",
      `${step.title}를 ${decision.toUpperCase()}로 기록했어요.\n${summarizeStepResults()}`
    );
  }

  async function sendToLocalBridge(userText) {
    const settings = state.settings || DEFAULT_SETTINGS;
    if (!settings.localBridgeEnabled || !settings.localBridgeUrl) {
      return null;
    }

    const payload = {
      source: "aes-jira-bot-extension",
      locale: "ko-KR",
      userMessage: userText,
      issue: {
        key: state.currentIssue?.key || state.activeIssueKey || "",
        summary: state.currentIssue?.fields?.summary || "",
        status: state.currentIssue?.fields?.status?.name || "",
        project: state.currentIssue?.fields?.project?.key || extractProjectFromKey(state.activeIssueKey)
      },
      stepContext: {
        currentStep: getCurrentStepInfo(),
        totalSteps: Array.isArray(state.stepFlow) ? state.stepFlow.length : 0,
        stepCursor: state.stepCursor,
        stepResults: state.stepResults
      },
      recommendedIssues: (state.recommendedItems || []).slice(0, 6).map((item) => ({
        key: item.key,
        summary: item.fields?.summary || "",
        score: item.score || 0,
        reasonText: item.reasonText || ""
      })),
      alertItems: (state.alertItems || []).slice(0, 8).map((item) => ({
        key: item.key,
        summary: item.summary || "",
        status: item.status || "",
        updated: item.updated || ""
      }))
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, settings.localBridgeTimeoutMs || DEFAULT_SETTINGS.localBridgeTimeoutMs);

    try {
      const response = await fetch(settings.localBridgeUrl, {
        method: "POST",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`브릿지 응답 실패 (${response.status})`);
      }

      const textBody = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(textBody);
      } catch {
        parsed = null;
      }

      if (parsed && typeof parsed === "object") {
        const candidate =
          parsed.reply || parsed.message || parsed.text || parsed.output || parsed?.data?.reply || "";
        if (candidate) {
          return String(candidate);
        }
      }
      return textBody ? String(textBody).trim() : null;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function maybeForwardToBridge(userText, silentUserEcho) {
    if (silentUserEcho) {
      return;
    }
    try {
      const reply = await sendToLocalBridge(userText);
      if (reply) {
        appendChatMessage("bot", reply);
      }
      state.bridgeFailureNotified = false;
    } catch (error) {
      if (state.bridgeFailureNotified) {
        return;
      }
      state.bridgeFailureNotified = true;
      const message = error instanceof Error ? error.message : "브릿지 연결 오류";
      appendChatMessage("bot", `로컬 브릿지 연결에 실패했어요: ${message}`);
    }
  }

  async function handleUserPrompt(text, silentUserEcho) {
    if (!silentUserEcho) {
      appendChatMessage("user", text);
    }
    const normalized = normalizeText(text);
    let handled = false;

    if (["help", "/help", "도움말", "도움", "명령어"].includes(normalized)) {
      handled = true;
      appendChatMessage(
        "bot",
        "사용 가능한 명령어:\n- 새로고침\n- 이슈 열기 SCRUM-1\n- 알림 보여줘\n- 지금 알림 확인\n- 추천 이슈 보여줘\n- pass / fail / 다음 step"
      );
    } else if (normalized.includes("새로고침") || normalized === "refresh" || normalized === "/refresh") {
      handled = true;
      appendChatMessage("bot", "현재 이슈를 다시 분석할게요.");
      void refreshForCurrentUrl(true);
    } else {
      const openMatch =
        text.match(/(?:open|goto|go|열기|이동)\s+([A-Z][A-Z0-9]+-\d+)/i) || text.match(/^([A-Z][A-Z0-9]+-\d+)$/i);
      if (openMatch) {
        handled = true;
        const issueKey = openMatch[1].toUpperCase();
        appendChatMessage("bot", `${issueKey} 이슈로 이동할게요.`);
        window.location.href = `${window.location.origin}/browse/${issueKey}`;
      }
    }

    if (!handled && (normalized.includes("알림") || normalized.includes("alert"))) {
      handled = true;
      setActiveTab("alerts");
      await showAlertListMessage();
    }

    if (!handled && (normalized.includes("poll") || normalized.includes("지금 알림") || normalized.includes("즉시 확인"))) {
      handled = true;
      setActiveTab("alerts");
      appendChatMessage("bot", "알림을 즉시 확인 중입니다.");
      await pollAlertsNow();
      await showAlertListMessage();
    }

    if (!handled && (normalized.includes("추천") || normalized.includes("연관 기능") || normalized.includes("유사"))) {
      handled = true;
      if (!state.activeIssueKey) {
        appendChatMessage("bot", "먼저 이슈 상세 페이지(`/browse/KEY-123`)를 열어주세요.");
      } else if (state.recommendedItems.length === 0) {
        appendChatMessage("bot", "추천 후보를 아직 찾지 못했습니다. `새로고침` 후 다시 시도해 주세요.");
      } else {
        const bubble = appendChatMessage("bot", `${state.activeIssueKey} 기준 추천 이슈입니다.`);
        if (bubble) {
          bubble.appendChild(createRecommendedListNode(state.recommendedItems));
        }
      }
    }

    if (!handled && (normalized === "pass" || normalized === "p" || normalized.includes("통과"))) {
      handled = true;
      handleStepDecision("pass");
    }

    if (!handled && (normalized === "fail" || normalized === "f" || normalized.includes("실패"))) {
      handled = true;
      handleStepDecision("fail");
    }

    if (!handled && (normalized.includes("다음 step") || normalized.includes("다음 단계") || normalized === "next")) {
      handled = true;
      if (moveToNextStep()) {
        announceCurrentStep("다음 단계로 이동했어요.");
      } else {
        appendChatMessage("bot", "이미 마지막 단계입니다.");
      }
    }

    if (!handled) {
      appendChatMessage(
        "bot",
        "요청을 이해하지 못했어요. `도움말`, `추천 이슈 보여줘`, `알림 보여줘`, `새로고침`, `pass`, `fail` 중 하나를 써주세요."
      );
    }

    await maybeForwardToBridge(text, silentUserEcho);
  }

  function renderState(text, error) {
    if (!state.body) {
      return;
    }
    setDataMessageContent(text, error);
  }

  function buildIssueFields(settings) {
    const fields = ["summary", "labels", "issuelinks", "status", "project", "components", "updated"];
    if (settings.productFieldId) {
      fields.push(settings.productFieldId);
    }
    if (settings.stepFieldId && settings.stepFieldId !== settings.productFieldId) {
      fields.push(settings.stepFieldId);
    }
    return fields.join(",");
  }

  async function fetchIssue(issueKey, settings) {
    const endpoint = new URL(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, window.location.origin);
    endpoint.searchParams.set("fields", buildIssueFields(settings));
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`${issueKey} 조회 실패 (${response.status})`);
    }
    return response.json();
  }

  function parseLinkTypeFilter(settings) {
    if (!settings.linkTypeFilter) {
      return [];
    }
    return settings.linkTypeFilter
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
  }

  function isAllowedLinkType(link, allowedTypes) {
    if (allowedTypes.length === 0) {
      return true;
    }
    const typeName = (link?.type?.name || "").toLowerCase();
    return allowedTypes.includes(typeName);
  }

  function extractRelatedKeys(issue, settings) {
    const links = issue?.fields?.issuelinks || [];
    const allowedTypes = parseLinkTypeFilter(settings);
    const keys = new Set();

    for (const link of links) {
      if (!isAllowedLinkType(link, allowedTypes)) {
        continue;
      }
      const outwardKey = link?.outwardIssue?.key;
      if (outwardKey) {
        keys.add(outwardKey.toUpperCase());
      }
      const inwardKey = link?.inwardIssue?.key;
      if (inwardKey) {
        keys.add(inwardKey.toUpperCase());
      }
    }

    return [...keys];
  }

  function pickProduct(issue, settings) {
    const productByField = readFieldText(issue, settings.productFieldId);
    if (productByField) {
      return productByField;
    }

    const labels = issue?.fields?.labels || [];
    const prefix = settings.productLabelPrefix || DEFAULT_SETTINGS.productLabelPrefix;
    const normalizedPrefix = prefix.toLowerCase();

    for (const label of labels) {
      if (label.toLowerCase().startsWith(normalizedPrefix)) {
        const value = label.slice(prefix.length).trim();
        return value || "미분류";
      }
    }
    return "미분류";
  }

  function formatStepTitle(order, rest) {
    if (!Number.isFinite(order)) {
      return rest ? rest : "미지정";
    }
    return rest ? `단계 ${order} - ${rest}` : `단계 ${order}`;
  }

  function parseStepBody(stepBody) {
    const cleaned = String(stepBody || "").trim();
    if (!cleaned) {
      return {
        id: "step-unspecified",
        order: Number.MAX_SAFE_INTEGER,
        title: "미지정"
      };
    }

    const numbered = cleaned.match(/^(\d+)[\s:_-]*(.*)$/);
    if (numbered) {
      const order = Number.parseInt(numbered[1], 10);
      const rest = numbered[2].trim();
      return {
        id: `step-${order}-${rest.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "base"}`,
        order,
        title: formatStepTitle(order, rest)
      };
    }

    return {
      id: `step-${cleaned.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      order: Number.MAX_SAFE_INTEGER - 1,
      title: cleaned
    };
  }

  function safeRegExp(pattern) {
    try {
      return new RegExp(pattern, "i");
    } catch {
      return null;
    }
  }

  function readFieldText(issue, fieldId) {
    if (!fieldId) {
      return "";
    }
    const value = issue?.fields?.[fieldId];
    if (value == null) {
      return "";
    }
    if (typeof value === "string" || typeof value === "number") {
      return String(value).trim();
    }
    if (Array.isArray(value)) {
      const parts = value.map((item) => {
        if (item == null) {
          return "";
        }
        if (typeof item === "string" || typeof item === "number") {
          return String(item);
        }
        if (typeof item === "object") {
          return String(item.value || item.name || item.id || "");
        }
        return "";
      });
      return parts.filter(Boolean).join(", ").trim();
    }
    if (typeof value === "object") {
      return String(value.value || value.name || value.id || "").trim();
    }
    return "";
  }

  function pickStep(issue, settings) {
    const stepByField = readFieldText(issue, settings.stepFieldId);
    if (stepByField) {
      return parseStepBody(stepByField);
    }

    const labels = issue?.fields?.labels || [];
    const prefix = settings.stepLabelPrefix || DEFAULT_SETTINGS.stepLabelPrefix;
    const normalizedPrefix = prefix.toLowerCase();

    for (const label of labels) {
      if (label.toLowerCase().startsWith(normalizedPrefix)) {
        return parseStepBody(label.slice(prefix.length));
      }
    }

    const summary = issue?.fields?.summary || "";
    const re = safeRegExp(settings.stepRegex);
    if (re) {
      const match = re.exec(summary);
      if (match && match[1]) {
        return parseStepBody(match[1]);
      }
    }

    return parseStepBody("");
  }

  function sortByStep(a, b) {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.title.localeCompare(b.title);
  }

  function sortByIssueKey(a, b) {
    return a.key.localeCompare(b.key, "en");
  }

  function buildGroups(relatedIssues, settings) {
    const productMap = new Map();

    for (const issue of relatedIssues) {
      const product = pickProduct(issue, settings);
      const step = pickStep(issue, settings);

      if (!productMap.has(product)) {
        productMap.set(product, { name: product, count: 0, steps: new Map() });
      }
      const productNode = productMap.get(product);
      productNode.count += 1;

      if (!productNode.steps.has(step.id)) {
        productNode.steps.set(step.id, {
          id: step.id,
          order: step.order,
          title: step.title,
          issues: []
        });
      }
      productNode.steps.get(step.id).issues.push(issue);
    }

    const products = [...productMap.values()]
      .map((product) => {
        const steps = [...product.steps.values()]
          .map((step) => ({
            ...step,
            issues: step.issues.sort(sortByIssueKey)
          }))
          .sort(sortByStep);
        return {
          name: product.name,
          count: product.count,
          steps
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return products;
  }

  function createIssueItem(issue) {
    const li = document.createElement("li");
    li.className = "jrsv-issue";

    const left = document.createElement("div");
    const link = document.createElement("a");
    link.className = "jrsv-issue-link";
    link.href = `${window.location.origin}/browse/${issue.key}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = issue.key;

    const summary = document.createElement("span");
    summary.className = "jrsv-issue-summary";
    summary.textContent = issue?.fields?.summary ? ` ${issue.fields.summary}` : "";

    left.appendChild(link);
    left.appendChild(summary);

    const status = document.createElement("div");
    status.className = "jrsv-issue-status";
    status.textContent = issue?.fields?.status?.name || "";

    li.appendChild(left);
    li.appendChild(status);
    return li;
  }

  function renderGroups(issueKey, groups, truncatedCount, recommendedItems, alertItems) {
    if (!state.body) {
      return;
    }

    const totalRelated = groups.reduce((acc, product) => acc + product.count, 0);
    setSubtitle(`${issueKey} 분석 완료 - 관련 ${totalRelated}건`);

    const wrap = document.createElement("div");
    wrap.className = "jrsv-dashboard";

    wrap.appendChild(createSectionTitle("연결된 단계 이슈"));
    if (groups.length === 0) {
      const noRelated = document.createElement("div");
      noRelated.className = "jrsv-state";
      noRelated.textContent = "연결된 관련 이슈가 없습니다.";
      wrap.appendChild(noRelated);
    }

    if (truncatedCount > 0) {
      const note = document.createElement("div");
      note.className = "jrsv-state";
      note.textContent = `조회 제한으로 ${truncatedCount}건은 생략했습니다.`;
      wrap.appendChild(note);
    }

    for (const product of groups) {
      const details = document.createElement("details");
      details.className = "jrsv-product";
      details.open = true;

      const summary = document.createElement("summary");
      summary.className = "jrsv-product-summary";
      summary.textContent = `${product.name} (${product.count})`;

      const body = document.createElement("div");
      body.className = "jrsv-product-body";

      for (const step of product.steps) {
        const stepWrap = document.createElement("section");
        stepWrap.className = "jrsv-step";

        const stepTitle = document.createElement("div");
        stepTitle.className = "jrsv-step-title";
        stepTitle.textContent = `${step.title} (${step.issues.length})`;

        const issueList = document.createElement("ul");
        issueList.className = "jrsv-issues";
        for (const issue of step.issues) {
          issueList.appendChild(createIssueItem(issue));
        }

        stepWrap.appendChild(stepTitle);
        stepWrap.appendChild(issueList);
        body.appendChild(stepWrap);
      }

      details.appendChild(summary);
      details.appendChild(body);
      wrap.appendChild(details);
    }

    wrap.appendChild(createSectionTitle("기능 유사 이슈 추천"));
    wrap.appendChild(createRecommendedListNode(recommendedItems || []));

    wrap.appendChild(createSectionTitle("최근 알림"));
    wrap.appendChild(createAlertListNode(alertItems || []));

    setDataMessageContent(wrap, false);
  }

  async function refreshForCurrentUrl(force) {
    createLauncher();
    createPanel();

    const issueKey = extractIssueKey(window.location.href);
    switchChatRoom(issueKey);
    if (!issueKey) {
      state.activeIssueKey = null;
      state.currentIssue = null;
      state.recommendedItems = [];
      state.stepFlow = [];
      state.stepCursor = 0;
      state.stepResults = {};
      setSubtitle("이슈 페이지를 기다리는 중");
      renderState("`/browse/ISSUE-123` 형태의 Jira 이슈 페이지에서 분석할 수 있어요.", false);
      return;
    }
    if (!force && issueKey === state.activeIssueKey) {
      return;
    }

    setPanelOpen(true);
    state.activeIssueKey = issueKey;
    setSubtitle(`${issueKey} 분석 중...`);
    renderState("관련 이슈와 추천 후보를 불러오고 있습니다...", false);

    const token = ++state.loadingToken;
    try {
      const settings = await loadSettings(issueKey);
      state.settings = settings;
      const alertItems = await syncAlertInbox();
      const issue = await fetchIssue(issueKey, settings);
      state.currentIssue = issue;
      const allRelatedKeys = extractRelatedKeys(issue, settings).filter((key) => key !== issueKey);
      const limitedKeys = allRelatedKeys.slice(0, settings.maxRelatedIssues);
      const truncatedCount = Math.max(0, allRelatedKeys.length - limitedKeys.length);

      const relatedIssuesPromise = Promise.all(limitedKeys.map((key) => fetchIssue(key, settings)));
      const recommendedPromise = fetchRecommendedIssues(issue);
      const [relatedIssues, recommended] = await Promise.all([relatedIssuesPromise, recommendedPromise]);
      if (token !== state.loadingToken) {
        return;
      }

      const groups = buildGroups(relatedIssues, settings);
      state.recommendedItems = recommended;
      setStepFlowFromGroups(groups);
      renderGroups(issueKey, groups, truncatedCount, recommended, alertItems);
      appendChatMessage(
        "bot",
        `${issueKey} 분석 완료: 관련 ${groups.reduce((acc, p) => acc + p.count, 0)}건, 추천 ${recommended.length}건`
      );
      announceCurrentStep("단계 진행을 시작할게요.");
    } catch (error) {
      if (token !== state.loadingToken) {
        return;
      }
      const message = error instanceof Error ? error.message : "원인을 알 수 없는 오류";
      setSubtitle(issueKey);
      renderState(`분석 중 오류가 발생했습니다: ${message}`, true);
    }
  }

  function onNavigationCheck() {
    if (window.location.href === state.lastKnownHref) {
      return;
    }
    state.lastKnownHref = window.location.href;
    void refreshForCurrentUrl(true);
  }

  function wireNavigationListeners() {
    const rawPushState = history.pushState;
    history.pushState = function patchedPushState(...args) {
      const result = rawPushState.apply(this, args);
      queueMicrotask(onNavigationCheck);
      return result;
    };

    const rawReplaceState = history.replaceState;
    history.replaceState = function patchedReplaceState(...args) {
      const result = rawReplaceState.apply(this, args);
      queueMicrotask(onNavigationCheck);
      return result;
    };

    window.addEventListener("popstate", onNavigationCheck);
    window.setInterval(onNavigationCheck, 1200);
  }

  function wireRuntimeListeners() {
    if (!chrome?.runtime?.onMessage) {
      return;
    }
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === "jrsv:newAlerts") {
        const incoming = Array.isArray(message.items) ? message.items : [];
        if (incoming.length === 0) {
          return;
        }
        updateAlertCache(incoming);
        renderAlertsTab();
        const latest = incoming
          .slice(0, 3)
          .map((item) => item.key)
          .filter(Boolean)
          .join(", ");
        appendChatMessage(
          "bot",
          `새 알림 ${incoming.length}건이 도착했어요.${latest ? ` (${latest})` : ""}`
        );
        if (state.activeIssueKey) {
          renderState("새 알림이 도착했습니다. 최신 정보를 반영합니다...", false);
          void refreshForCurrentUrl(true);
        }
      }
    });
  }

  function boot() {
    createLauncher();
    createPanel();
    setPanelOpen(true);
    wireNavigationListeners();
    wireRuntimeListeners();
    void refreshForCurrentUrl(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
