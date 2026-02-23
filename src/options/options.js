const STORAGE_KEY = "jrsv.settings";
const DEFAULT_SETTINGS = Object.freeze({
  jiraBaseUrl: "https://dhwoo.atlassian.net",
  alertEnabled: true,
  alertIntervalMin: 3,
  alertLookbackMin: 10,
  productLabelPrefix: "product:",
  stepLabelPrefix: "step:",
  stepRegex: "(?:^|\\s)step[:\\-_ ]?(\\d+)",
  maxRelatedIssues: 50,
  productFieldId: "",
  stepFieldId: "",
  linkTypeFilter: ""
});
const SCRUM_PRESET_SETTINGS = Object.freeze({
  jiraBaseUrl: "https://dhwoo.atlassian.net",
  alertEnabled: true,
  alertIntervalMin: 3,
  alertLookbackMin: 10,
  productLabelPrefix: "product:",
  stepLabelPrefix: "step:",
  stepRegex: "(?:^|\\s)step[:\\-_ ]?(\\d+)",
  maxRelatedIssues: 80,
  productFieldId: "",
  stepFieldId: "",
  linkTypeFilter: "Relates"
});

function storageGet(key) {
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

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: value }, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function byId(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
}

async function restore() {
  const stored = await storageGet(STORAGE_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(stored || {}) };

  byId("jiraBaseUrl").value = merged.jiraBaseUrl || DEFAULT_SETTINGS.jiraBaseUrl;
  byId("alertEnabled").checked = Boolean(merged.alertEnabled);
  byId("alertIntervalMin").value = String(merged.alertIntervalMin || DEFAULT_SETTINGS.alertIntervalMin);
  byId("alertLookbackMin").value = String(merged.alertLookbackMin || DEFAULT_SETTINGS.alertLookbackMin);
  byId("productLabelPrefix").value = merged.productLabelPrefix;
  byId("stepLabelPrefix").value = merged.stepLabelPrefix;
  byId("stepRegex").value = merged.stepRegex;
  byId("productFieldId").value = merged.productFieldId || "";
  byId("stepFieldId").value = merged.stepFieldId || "";
  byId("linkTypeFilter").value = merged.linkTypeFilter || "";
  byId("maxRelatedIssues").value = String(merged.maxRelatedIssues);
}

async function onSave(event) {
  event.preventDefault();

  const payload = {
    jiraBaseUrl:
      byId("jiraBaseUrl").value.trim().replace(/\/+$/, "") || DEFAULT_SETTINGS.jiraBaseUrl,
    alertEnabled: byId("alertEnabled").checked,
    alertIntervalMin:
      Number.parseInt(byId("alertIntervalMin").value, 10) || DEFAULT_SETTINGS.alertIntervalMin,
    alertLookbackMin:
      Number.parseInt(byId("alertLookbackMin").value, 10) || DEFAULT_SETTINGS.alertLookbackMin,
    productLabelPrefix: byId("productLabelPrefix").value.trim() || DEFAULT_SETTINGS.productLabelPrefix,
    stepLabelPrefix: byId("stepLabelPrefix").value.trim() || DEFAULT_SETTINGS.stepLabelPrefix,
    stepRegex: byId("stepRegex").value.trim() || DEFAULT_SETTINGS.stepRegex,
    productFieldId: byId("productFieldId").value.trim(),
    stepFieldId: byId("stepFieldId").value.trim(),
    linkTypeFilter: byId("linkTypeFilter").value.trim(),
    maxRelatedIssues: Number.parseInt(byId("maxRelatedIssues").value, 10) || DEFAULT_SETTINGS.maxRelatedIssues
  };

  payload.maxRelatedIssues = Math.max(1, Math.min(500, payload.maxRelatedIssues));
  payload.alertIntervalMin = Math.max(1, Math.min(30, payload.alertIntervalMin));
  payload.alertLookbackMin = Math.max(3, Math.min(180, payload.alertLookbackMin));

  const status = byId("status");
  status.textContent = "";

  try {
    await storageSet(payload);
    status.textContent = "Saved";
    window.setTimeout(() => {
      status.textContent = "";
    }, 1400);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Failed to save";
  }
}

function fillForm(settings) {
  byId("jiraBaseUrl").value = settings.jiraBaseUrl || DEFAULT_SETTINGS.jiraBaseUrl;
  byId("alertEnabled").checked = Boolean(settings.alertEnabled);
  byId("alertIntervalMin").value = String(settings.alertIntervalMin || DEFAULT_SETTINGS.alertIntervalMin);
  byId("alertLookbackMin").value = String(settings.alertLookbackMin || DEFAULT_SETTINGS.alertLookbackMin);
  byId("productLabelPrefix").value = settings.productLabelPrefix;
  byId("stepLabelPrefix").value = settings.stepLabelPrefix;
  byId("stepRegex").value = settings.stepRegex;
  byId("productFieldId").value = settings.productFieldId || "";
  byId("stepFieldId").value = settings.stepFieldId || "";
  byId("linkTypeFilter").value = settings.linkTypeFilter || "";
  byId("maxRelatedIssues").value = String(settings.maxRelatedIssues);
}

async function applyScrumPreset() {
  fillForm(SCRUM_PRESET_SETTINGS);
  await storageSet(SCRUM_PRESET_SETTINGS);
  const status = byId("status");
  status.textContent = "SCRUM preset applied";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1600);
}

document.getElementById("settings-form").addEventListener("submit", (event) => {
  void onSave(event);
});
document.getElementById("apply-scrum-preset-btn").addEventListener("click", () => {
  void applyScrumPreset();
});
void restore();
