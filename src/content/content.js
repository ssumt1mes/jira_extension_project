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
  const STORAGE_KEY = "jrsv.settings";
  const DEFAULT_SETTINGS = Object.freeze({
    productLabelPrefix: "product:",
    stepLabelPrefix: "step:",
    stepRegex: "(?:^|\\s)step[:\\-_ ]?(\\d+)",
    maxRelatedIssues: 50,
    productFieldId: "",
    stepFieldId: "",
    linkTypeFilter: ""
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
      linkTypeFilter: "Relates"
    }
  });

  const state = {
    launcher: null,
    panel: null,
    body: null,
    subtitle: null,
    messages: null,
    composerInput: null,
    dataMessageBody: null,
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
    const merged = stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS, ...(preset || {}) };
    merged.maxRelatedIssues = Number.parseInt(merged.maxRelatedIssues, 10);
    if (!Number.isFinite(merged.maxRelatedIssues) || merged.maxRelatedIssues < 1) {
      merged.maxRelatedIssues = DEFAULT_SETTINGS.maxRelatedIssues;
    }
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
      state.launcher.title = state.isOpen ? "Close AES Jira Bot" : "Open AES Jira Bot";
      state.launcher.setAttribute(
        "aria-label",
        state.isOpen ? "Close AES Jira Bot" : "Open AES Jira Bot"
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
    launcher.title = "Open AES Jira Bot";
    launcher.setAttribute("aria-label", "Open AES Jira Bot");
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
    subtitle.textContent = "Open an issue to load related steps";
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const actions = document.createElement("div");
    actions.className = "jrsv-actions";

    const refreshButton = document.createElement("button");
    refreshButton.className = "jrsv-btn";
    refreshButton.type = "button";
    refreshButton.textContent = "Refresh";
    refreshButton.addEventListener("click", () => {
      void refreshForCurrentUrl(true);
    });

    const closeButton = document.createElement("button");
    closeButton.className = "jrsv-btn";
    closeButton.type = "button";
    closeButton.textContent = "X";
    closeButton.title = "Close";
    closeButton.addEventListener("click", () => {
      setPanelOpen(false);
    });

    actions.appendChild(refreshButton);
    actions.appendChild(closeButton);

    header.appendChild(titleWrap);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "jrsv-body";

    const messages = document.createElement("div");
    messages.className = "jrsv-chat-log";

    const composer = document.createElement("form");
    composer.className = "jrsv-composer";
    composer.autocomplete = "off";

    const input = document.createElement("input");
    input.className = "jrsv-input";
    input.type = "text";
    input.placeholder = "Type: help, refresh, open SCRUM-1, alerts";

    const sendButton = document.createElement("button");
    sendButton.className = "jrsv-send";
    sendButton.type = "submit";
    sendButton.textContent = "Send";

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

    body.appendChild(messages);
    body.appendChild(composer);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    state.panel = panel;
    state.body = body;
    state.subtitle = subtitle;
    state.messages = messages;
    state.composerInput = input;
    state.dataMessageBody = null;

    appendChatMessage("bot", "Ready. Open an issue and I can show related steps. Type `help` for commands.");
    ensureDataMessageBody();
  }

  function setSubtitle(text) {
    if (state.subtitle) {
      state.subtitle.textContent = text;
    }
  }

  function appendChatMessage(role, text) {
    if (!state.messages) {
      return null;
    }
    const row = document.createElement("div");
    row.className = `jrsv-msg jrsv-msg-${role}`;

    const bubble = document.createElement("div");
    bubble.className = "jrsv-msg-bubble";
    bubble.textContent = text;

    row.appendChild(bubble);
    state.messages.appendChild(row);
    state.messages.scrollTop = state.messages.scrollHeight;
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
    const bubble = document.createElement("div");
    bubble.className = "jrsv-msg-bubble";
    bubble.textContent = "No data loaded yet.";
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
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function buildAlertDigest(items) {
    if (!items.length) {
      return "No recent alerts yet.";
    }
    return items
      .slice(0, 6)
      .map((item) => `${item.key} [${item.status || "-"}] ${item.summary}`)
      .join("\n");
  }

  async function handleUserPrompt(text) {
    appendChatMessage("user", text);
    const normalized = text.toLowerCase();

    if (normalized === "help" || normalized === "/help") {
      appendChatMessage(
        "bot",
        "Commands:\n- refresh\n- open SCRUM-1\n- alerts\n- poll now\n\nLLM mode will be added later."
      );
      return;
    }

    if (normalized === "refresh" || normalized === "/refresh" || normalized === "새로고침") {
      appendChatMessage("bot", "Refreshing this issue now.");
      void refreshForCurrentUrl(true);
      return;
    }

    const openMatch =
      text.match(/(?:open|goto|go)\s+([A-Z][A-Z0-9]+-\d+)/i) || text.match(/^([A-Z][A-Z0-9]+-\d+)$/i);
    if (openMatch) {
      const issueKey = openMatch[1].toUpperCase();
      appendChatMessage("bot", `Moving to ${issueKey}.`);
      window.location.href = `${window.location.origin}/browse/${issueKey}`;
      return;
    }

    if (normalized.includes("alerts") || normalized.includes("alert") || normalized.includes("알림")) {
      const response = await sendRuntimeMessage({ type: "jrsv:getAlertInbox" });
      const items = Array.isArray(response?.items) ? response.items : [];
      appendChatMessage("bot", `Recent alerts:\n${buildAlertDigest(items)}`);
      return;
    }

    if (normalized.includes("poll")) {
      const response = await sendRuntimeMessage({ type: "jrsv:pollNow" });
      if (response?.ok) {
        appendChatMessage("bot", `Poll completed. New alerts: ${response.newCount || 0}`);
      } else {
        appendChatMessage("bot", `Poll failed: ${response?.error || "Unknown error"}`);
      }
      return;
    }

    appendChatMessage(
      "bot",
      "I can do command-style chat now. Try: help / refresh / open SCRUM-1 / alerts"
    );
  }

  function renderState(text, error) {
    if (!state.body) {
      return;
    }
    setDataMessageContent(text, error);
  }

  function buildIssueFields(settings) {
    const fields = ["summary", "labels", "issuelinks", "status"];
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
      throw new Error(`${issueKey} load failed (${response.status})`);
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
        return value || "Unassigned";
      }
    }
    return "Unassigned";
  }

  function formatStepTitle(order, rest) {
    if (!Number.isFinite(order)) {
      return rest ? rest : "Unspecified";
    }
    return rest ? `Step ${order} - ${rest}` : `Step ${order}`;
  }

  function parseStepBody(stepBody) {
    const cleaned = String(stepBody || "").trim();
    if (!cleaned) {
      return {
        id: "step-unspecified",
        order: Number.MAX_SAFE_INTEGER,
        title: "Unspecified"
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

  function renderGroups(issueKey, groups, truncatedCount) {
    if (!state.body) {
      return;
    }

    setSubtitle(`${issueKey} related issues: ${groups.reduce((acc, p) => acc + p.count, 0)}`);

    if (groups.length === 0) {
      renderState("No related issues in issue links.", false);
      return;
    }

    const wrap = document.createElement("div");
    if (truncatedCount > 0) {
      const note = document.createElement("div");
      note.className = "jrsv-state";
      note.textContent = `${truncatedCount} related issues were skipped by max limit.`;
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

    setDataMessageContent(wrap, false);
  }

  async function refreshForCurrentUrl(force) {
    createLauncher();
    createPanel();

    const issueKey = extractIssueKey(window.location.href);
    if (!issueKey) {
      state.activeIssueKey = null;
      setSubtitle("Waiting for issue page");
      renderState("Move to /browse/ISSUE-KEY page and open this panel.", false);
      return;
    }
    if (!force && issueKey === state.activeIssueKey) {
      return;
    }

    setPanelOpen(true);
    state.activeIssueKey = issueKey;
    setSubtitle(`Loading ${issueKey}...`);
    renderState("Loading related issues...", false);

    const token = ++state.loadingToken;
    try {
      const settings = await loadSettings(issueKey);
      const issue = await fetchIssue(issueKey, settings);
      const allRelatedKeys = extractRelatedKeys(issue, settings).filter((key) => key !== issueKey);
      const limitedKeys = allRelatedKeys.slice(0, settings.maxRelatedIssues);
      const truncatedCount = Math.max(0, allRelatedKeys.length - limitedKeys.length);

      const relatedIssues = await Promise.all(limitedKeys.map((key) => fetchIssue(key, settings)));
      if (token !== state.loadingToken) {
        return;
      }

      const groups = buildGroups(relatedIssues, settings);
      renderGroups(issueKey, groups, truncatedCount);
    } catch (error) {
      if (token !== state.loadingToken) {
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      setSubtitle(issueKey);
      renderState(message, true);
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

  function boot() {
    createLauncher();
    createPanel();
    setPanelOpen(true);
    wireNavigationListeners();
    void refreshForCurrentUrl(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
