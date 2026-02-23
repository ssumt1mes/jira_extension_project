const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium, test, expect } = require("@playwright/test");

function createIssue(key, summary, labels, links, statusName) {
  return {
    id: key,
    key,
    fields: {
      summary,
      labels,
      issuelinks: links || [],
      status: {
        name: statusName || "To Do"
      }
    }
  };
}

const issues = {
  "COMMONR-380": createIssue(
    "COMMONR-380",
    "Main test issue",
    ["product:Core"],
    [
      { outwardIssue: { key: "REL-101" } },
      { outwardIssue: { key: "REL-102" } },
      { inwardIssue: { key: "REL-103" } }
    ],
    "In Review"
  ),
  "REL-101": createIssue("REL-101", "Search login flow", ["product:Search", "step:01-login"], [], "Done"),
  "REL-102": createIssue("REL-102", "Search checkout flow", ["product:Search", "step:02-checkout"], [], "In QA"),
  "REL-103": createIssue("REL-103", "Payments login validation", ["product:Payments", "step:01-login"], [], "To Do")
};

function startMockServer() {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");

    if (requestUrl.pathname === "/browse/COMMONR-380") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <head><title>Jira Mock</title></head>
  <body>
    <h1>COMMONR-380</h1>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname.startsWith("/rest/api/3/issue/")) {
      const key = decodeURIComponent(requestUrl.pathname.split("/").pop() || "").toUpperCase();
      if (!issues[key]) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(issues[key]));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`
      });
    });
  });
}

test("shows related issues grouped by product and step", async () => {
  const { server, baseUrl } = await startMockServer();
  const extensionPath = path.resolve(__dirname, "..", "..");
  const userDataDir = path.resolve(__dirname, "..", "tmp", `profile-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/browse/COMMONR-380`);

    const panel = page.locator("#jira-related-step-viewer");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("COMMONR-380");
    await expect(panel).toContainText("Search (2)");
    await expect(panel).toContainText("Payments (1)");
    await expect(panel).toContainText("Step 1 - login");
    await expect(panel).toContainText("Step 2 - checkout");
    await expect(panel).toContainText("REL-101");
    await expect(panel).toContainText("REL-102");
    await expect(panel).toContainText("REL-103");
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
