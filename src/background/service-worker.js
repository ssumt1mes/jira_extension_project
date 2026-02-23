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
    throw new Error(`Search failed (${response.status})`);
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

async function pollAndNotify() {
  const settings = await getSettings();
  if (!settings.alertEnabled || !settings.jiraBaseUrl) {
    return { newCount: 0 };
  }

  let seen = (await storageLocalGet(ALERT_SEEN_KEY)) || {};
  const inbox = (await storageLocalGet(ALERT_INBOX_KEY)) || [];
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
      createdAt: Date.now()
    });

    chrome.notifications.create(sanitizeNotificationId(`jrsv:${marker}`), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `Jira update: ${key}`,
      message: `${statusName ? `[${statusName}] ` : ""}${summary}`.slice(0, 240)
    });
  }

  if (newItems.length > 0) {
    const mergedInbox = [...newItems, ...inbox].slice(0, 80);
    await storageLocalSet({
      [ALERT_INBOX_KEY]: mergedInbox
    });
  }

  // Keep seen markers bounded.
  const seenEntries = Object.entries(seen)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 400);
  seen = Object.fromEntries(seenEntries);
  await storageLocalSet({
    [ALERT_SEEN_KEY]: seen
  });

  return { newCount: newItems.length };
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
    const inbox = (await storageLocalGet(ALERT_INBOX_KEY)) || [];
    const item = inbox.find(
      (entry) => sanitizeNotificationId(`jrsv:${entry.id}`) === notificationId || entry.id === marker
    );
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
      const inbox = (await storageLocalGet(ALERT_INBOX_KEY)) || [];
      sendResponse({ items: inbox.slice(0, 20) });
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
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    })();
    return true;
  }

  return undefined;
});
