const STORAGE_KEY = "jrsv.settings";
const ALERT_INBOX_KEY = "jrsv.alertInbox";
const ALERT_SEEN_KEY = "jrsv.alertSeen";
const ALERT_ALARM_NAME = "jrsv-alert-poll";

const DEFAULT_SETTINGS = Object.freeze({
  jiraBaseUrl: "https://dhwoo.atlassian.net",
  alertEnabled: true,
  alertIntervalMin: 3,
  alertLookbackMin: 10
});

function storageSyncGet(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (result) => {
      if (chrome.runtime?.lastError) {
        resolve(undefined);
        return;
      }
      resolve(result[key]);
    });
  });
}

function storageSyncSet(value) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(value, () => {
      resolve();
    });
  });
}

function storageLocalGet(key) {
  return new Promise((resolve) => {
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
    chrome.storage.local.set(value, () => {
      resolve();
    });
  });
}

function normalizeAlertItem(item) {
  if (!item || typeof item !== "object" || !item.id) {
    return null;
  }
  return {
    id: item.id,
    key: item.key || "",
    summary: item.summary || "",
    status: item.status || "",
    updated: item.updated || "",
    updatedLabel: item.updatedLabel || "",
    link: item.link || "",
    createdAt: item.createdAt || Date.now(),
    isRead: Boolean(item.isRead)
  };
}

function normalizeInbox(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map(normalizeAlertItem)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 120);
}

function buildInboxPayload(items) {
  const normalized = normalizeInbox(items);
  const unreadCount = normalized.filter((item) => !item.isRead).length;
  return {
    items: normalized.slice(0, 40),
    unreadCount
  };
}

async function getAlertInbox() {
  const raw = (await storageLocalGet(ALERT_INBOX_KEY)) || [];
  return normalizeInbox(raw);
}

async function setAlertInbox(items) {
  const normalized = normalizeInbox(items);
  await storageLocalSet({
    [ALERT_INBOX_KEY]: normalized
  });
  return normalized;
}

async function getSettings() {
  const stored = await storageSyncGet(STORAGE_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  merged.alertIntervalMin = Number.parseInt(merged.alertIntervalMin, 10);
  merged.alertLookbackMin = Number.parseInt(merged.alertLookbackMin, 10);
  if (!Number.isFinite(merged.alertIntervalMin)) {
    merged.alertIntervalMin = DEFAULT_SETTINGS.alertIntervalMin;
  }
  if (!Number.isFinite(merged.alertLookbackMin)) {
    merged.alertLookbackMin = DEFAULT_SETTINGS.alertLookbackMin;
  }
  merged.alertIntervalMin = Math.max(1, Math.min(30, merged.alertIntervalMin));
  merged.alertLookbackMin = Math.max(3, Math.min(180, merged.alertLookbackMin));
  merged.jiraBaseUrl = String(merged.jiraBaseUrl || DEFAULT_SETTINGS.jiraBaseUrl).replace(/\/+$/, "");
  merged.alertEnabled = Boolean(merged.alertEnabled);
  return merged;
}

function buildJql(settings) {
  return [
    "(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser())",
    `AND updated >= -${settings.alertLookbackMin}m`,
    "ORDER BY updated DESC"
  ].join(" ");
}

async function fetchRecentIssues(settings) {
  const jql = buildJql(settings);
  const endpoint = new URL("/rest/api/3/search", settings.jiraBaseUrl);
  endpoint.searchParams.set("jql", jql);
  endpoint.searchParams.set("maxResults", "25");
  endpoint.searchParams.set("fields", "summary,updated,status,assignee,reporter");

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`알림 조회 실패 (${response.status})`);
  }
  const json = await response.json();
  return Array.isArray(json?.issues) ? json.issues : [];
}

function sanitizeNotificationId(raw) {
  return raw.replace(/[^a-zA-Z0-9-_:.]/g, "-").slice(0, 180);
}

function formatUpdatedAt(isoText) {
  const dt = new Date(isoText);
  if (Number.isNaN(dt.getTime())) {
    return isoText || "";
  }
  return dt.toLocaleString();
}

async function broadcastNewAlerts(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({}, (result) => {
      resolve(Array.isArray(result) ? result : []);
    });
  });
  await Promise.all(
    tabs
      .filter((tab) => tab.id && typeof tab.url === "string")
      .filter((tab) => {
        const url = tab.url || "";
        return (
          url.includes("atlassian.net") ||
          url.includes("http://localhost/") ||
          url.includes("http://127.0.0.1/")
        );
      })
      .map(
        (tab) =>
          new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { type: "jrsv:newAlerts", items }, () => {
              resolve();
            });
          })
      )
  );
}

async function pollAndNotify() {
  const settings = await getSettings();
  if (!settings.alertEnabled || !settings.jiraBaseUrl) {
    return { newCount: 0, newItems: [] };
  }

  let seen = (await storageLocalGet(ALERT_SEEN_KEY)) || {};
  const inbox = await getAlertInbox();
  const recentIssues = await fetchRecentIssues(settings);

  const newItems = [];
  for (const issue of recentIssues) {
    const key = issue?.key;
    const updated = issue?.fields?.updated;
    if (!key || !updated) {
      continue;
    }

    const marker = `${key}:${updated}`;
    if (seen[marker]) {
      continue;
    }
    seen[marker] = Date.now();

    const summary = issue?.fields?.summary || "";
    const statusName = issue?.fields?.status?.name || "";
    const link = `${settings.jiraBaseUrl}/browse/${key}`;
    const updatedLabel = formatUpdatedAt(updated);

    newItems.push({
      id: marker,
      key,
      summary,
      status: statusName,
      updated,
      updatedLabel,
      link,
      createdAt: Date.now(),
      isRead: false
    });

    chrome.notifications.create(sanitizeNotificationId(`jrsv:${marker}`), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `Jira 변경 알림: ${key}`,
      message: `${statusName ? `[${statusName}] ` : ""}${summary}`.slice(0, 240)
    });
  }

  if (newItems.length > 0) {
    const mergedById = new Map();
    for (const item of newItems) {
      mergedById.set(item.id, item);
    }
    for (const item of inbox) {
      if (!mergedById.has(item.id)) {
        mergedById.set(item.id, item);
      }
    }
    const mergedInbox = [...mergedById.values()];
    await setAlertInbox(mergedInbox);
    await broadcastNewAlerts(newItems);
  }

  // Keep seen markers bounded.
  const seenEntries = Object.entries(seen)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 400);
  seen = Object.fromEntries(seenEntries);
  await storageLocalSet({
    [ALERT_SEEN_KEY]: seen
  });

  return { newCount: newItems.length, newItems };
}

async function scheduleAlarm() {
  const settings = await getSettings();
  chrome.alarms.create(ALERT_ALARM_NAME, {
    periodInMinutes: settings.alertIntervalMin
  });
}

async function ensureDefaultSettings() {
  const existing = await storageSyncGet(STORAGE_KEY);
  if (existing) {
    return;
  }
  await storageSyncSet({
    [STORAGE_KEY]: DEFAULT_SETTINGS
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings().then(() => scheduleAlarm());
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleAlarm();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEY]) {
    void scheduleAlarm();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALERT_ALARM_NAME) {
    return;
  }
  void pollAndNotify();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("jrsv:")) {
    return;
  }
  const marker = notificationId.slice(5);
  void (async () => {
    const inbox = await getAlertInbox();
    const item = inbox.find(
      (entry) => sanitizeNotificationId(`jrsv:${entry.id}`) === notificationId || entry.id === marker
    );
    if (item) {
      const updated = inbox.map((entry) => (entry.id === item.id ? { ...entry, isRead: true } : entry));
      await setAlertInbox(updated);
    }
    if (item?.link) {
      chrome.tabs.create({ url: item.link });
    }
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "jrsv:getAlertInbox") {
    void (async () => {
      const inbox = await getAlertInbox();
      sendResponse(buildInboxPayload(inbox));
    })();
    return true;
  }

  if (message.type === "jrsv:markAlertRead") {
    void (async () => {
      const inbox = await getAlertInbox();
      const targetId = String(message.id || "");
      const nextRead = message.isRead !== false;
      const updated = inbox.map((item) =>
        item.id === targetId
          ? {
              ...item,
              isRead: nextRead
            }
          : item
      );
      const saved = await setAlertInbox(updated);
      sendResponse({
        ok: true,
        ...buildInboxPayload(saved)
      });
    })();
    return true;
  }

  if (message.type === "jrsv:markAllAlertsRead") {
    void (async () => {
      const inbox = await getAlertInbox();
      const updated = inbox.map((item) => ({
        ...item,
        isRead: true
      }));
      const saved = await setAlertInbox(updated);
      sendResponse({
        ok: true,
        ...buildInboxPayload(saved)
      });
    })();
    return true;
  }

  if (message.type === "jrsv:deleteAlert") {
    void (async () => {
      const inbox = await getAlertInbox();
      const targetId = String(message.id || "");
      const updated = inbox.filter((item) => item.id !== targetId);
      const saved = await setAlertInbox(updated);
      sendResponse({
        ok: true,
        ...buildInboxPayload(saved)
      });
    })();
    return true;
  }

  if (message.type === "jrsv:deleteReadAlerts") {
    void (async () => {
      const inbox = await getAlertInbox();
      const updated = inbox.filter((item) => !item.isRead);
      const saved = await setAlertInbox(updated);
      sendResponse({
        ok: true,
        ...buildInboxPayload(saved)
      });
    })();
    return true;
  }

  if (message.type === "jrsv:pollNow") {
    void (async () => {
      try {
        const result = await pollAndNotify();
        sendResponse({ ok: true, ...result });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "원인을 알 수 없는 오류"
        });
      }
    })();
    return true;
  }

  return undefined;
});
