# Jira Related Step Viewer (Chromium)

Chromium extension that reads Jira `issuelinks` and shows related issues grouped as:

- `Product`
- `Step`
- `Related issues`

The panel appears on issue pages (`/browse/KEY-123`).
On all Jira pages, a launcher button appears at the bottom-right.

The panel is now chat-style and supports command input:

- `help`
- `refresh`
- `open SCRUM-1`
- `alerts`
- `poll now`

## 1. Install as unpacked extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/Users/dhwoo/Documents/extension`.
5. Open any Jira page and click the `Steps` launcher at bottom-right.

## 2. How mapping works

- Product: custom field (if configured) or first label with `product:` prefix.
  - Example: `product:Search`
- Step: custom field (if configured) or first label with `step:` prefix.
  - Example: `step:01-login`, `step:02-checkout`
- If step label is missing, regex fallback checks summary.
- Optional link type filter can include only selected link relations (for example `Relates, Blocks`).

You can change prefixes and regex in extension options page.

## 3. Built-in preset for your Jira

- Target: `https://dhwoo.atlassian.net` + issue key prefix `SCRUM-`
- Default preset values:
- `productLabelPrefix`: `product:`
- `stepLabelPrefix`: `step:`
- `stepRegex`: `(?:^|\\s)step[:\\-_ ]?(\\d+)`
- `linkTypeFilter`: `Relates`
- `maxRelatedIssues`: `80`

You can also open options page and click `Apply SCRUM Preset`.

## 4. Playwright verification

This repo includes E2E with a mock Jira server.

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Notes:

- Test launches Chromium with extension loaded.
- Default config runs in headed mode (`headless: false`) because extension loading is most stable there.

## 5. Alerting

Background service worker can notify when Jira issues are updated and you are:

- `assignee`
- `reporter`
- `watcher`

Alert options can be configured in extension options:

- `jiraBaseUrl`
- `alertEnabled`
- `alertIntervalMin`
- `alertLookbackMin`

Current implementation uses Jira polling API (no external server needed).
If you later want true Jira webhook push, you need a public webhook endpoint (relay server).

## 6. Files

- `manifest.json`: MV3 extension config
- `src/background/service-worker.js`: polling alerts + notifications
- `src/content/content.js`: Jira API fetch + grouping + panel rendering
- `src/content/content.css`: panel styles
- `src/options/*`: mapping options UI
- `tests/e2e/extension.spec.js`: Playwright E2E with mock Jira API
