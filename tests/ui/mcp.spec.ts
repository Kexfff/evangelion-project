import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/shared/schema";
import { mcpConfigSchema, type McpSnapshot } from "../../src/shared/mcp";

test("MCP preview explains trust and cannot start external programs", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "MCP connections" }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "MCP connections", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "MCP connections" }),
  ).toBeVisible();
  await expect(
    page.getByText("No connections yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add MCP connection" }).click();
  await page.getByLabel("Connection ID", { exact: true }).fill("fixture");
  await page.getByLabel("Connection name", { exact: true }).fill("Fixture");
  await page.getByLabel("Executable", { exact: true }).fill("/usr/bin/node");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("browser preview");
});

async function fixture(page: import("@playwright/test").Page, pending = false) {
  const mcp: McpSnapshot = {
    stopped: false,
    servers: [
      {
        config: mcpConfigSchema.parse({
          id: "fixture",
          name: "Fixture tools",
          transport: "stdio",
          command: "/usr/bin/node",
          args: ["fixture.mjs"],
          characterId: "eva",
          enabled: true,
        }),
        status: "Connected",
        hasSecrets: true,
        tools: [
          {
            name: "echo",
            description: "Untrusted description",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
            },
            fingerprint: "a".repeat(64),
            policy: "deny",
          },
        ],
      },
    ],
    pending: pending
      ? [
          {
            id: "request",
            serverId: "fixture",
            tool: "echo",
            arguments: '{"text":"Hello"}',
            channel: "telegram",
          },
        ]
      : [],
    audit: [],
  };
  await page.addInitScript(
    (snapshot) => {
      let listener: (event: unknown) => void = () => {};
      const publish = () =>
        listener({ type: "state", state: structuredClone(snapshot) });
      Object.assign(window, {
        eva: {
          snapshot: async () => structuredClone(snapshot),
          onEvent: (fn: typeof listener) => {
            listener = fn;
            return () => {};
          },
          assetUrl: (asset: string) =>
            asset === "builtin:eva"
              ? "/AvatarSample_B.vrm"
              : `/animations/${asset.slice(10)}.vrma`,
          configureMcp: async (
            config: (typeof snapshot.mcp.servers)[0]["config"],
            secrets?: unknown,
          ) => {
            Object.assign(window, { savedMcpSecrets: secrets });
            snapshot.mcp.servers[0] = {
              config: { ...config, enabled: false },
              status: "Disabled",
              hasSecrets: true,
              tools: [],
            };
            publish();
          },
          mcpGrant: async (
            _id: string,
            _tool: string,
            _fingerprint: string,
            policy: (typeof snapshot.mcp.servers)[0]["tools"][0]["policy"],
          ) => {
            snapshot.mcp.servers[0].tools[0].policy = policy;
            publish();
          },
          mcpApproval: async (id: string, allow: boolean) => {
            snapshot.mcp.pending = snapshot.mcp.pending.filter(
              (p) => p.id !== id,
            );
            snapshot.mcp.audit.push({
              id,
              at: new Date().toISOString(),
              serverId: "fixture",
              tool: "echo",
              outcome: allow ? "succeeded" : "denied",
            });
            publish();
          },
          stopTools: async () => {
            snapshot.mcp.stopped = true;
            snapshot.mcp.pending = [];
            snapshot.mcp.servers[0].config.enabled = false;
            snapshot.mcp.servers[0].status = "Disabled";
            snapshot.mcp.servers[0].tools = [];
            publish();
          },
          mcpAction: async (_id: string, action: string) => {
            if (action === "remove") snapshot.mcp.servers = [];
            publish();
          },
        },
      });
    },
    {
      settings: defaultSettings,
      facts: [],
      messages: [],
      sessionId: "test",
      busy: false,
      secretStorage: "local-file",
      mcp,
    },
  );
  await page.goto("/?window=settings");
}

test("MCP grants default blocked, allow needs confirmation, and editing retains secrets without displaying them", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  const permission = page.getByLabel("Permission for fixture/echo");
  await page
    .getByRole("button", { name: "MCP connections", exact: true })
    .click();
  await expect(permission).toHaveValue("deny");
  await permission.selectOption("ask");
  await expect(permission).toHaveValue("ask");
  page.once("dialog", (dialog) => dialog.dismiss());
  await permission.selectOption("allow");
  await expect(permission).toHaveValue("ask");
  page.once("dialog", (dialog) => dialog.accept());
  await permission.selectOption("allow");
  await expect(permission).toHaveValue("allow");
  await page
    .getByRole("button", { name: "Edit connection", exact: true })
    .click();
  await expect(
    page.getByLabel("Replace saved credentials", { exact: false }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Environment variables (secret JSON object)"),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).savedMcpSecrets),
  ).toBeUndefined();
  await expect(
    page.getByText("Disabled · Local program", { exact: false }),
  ).toBeVisible();
  await expect(permission).toHaveCount(0);
});

test("tool approval is visible across tabs and records a one-call decision", async ({
  page,
}) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "Review tool request" }).click();
  await expect(
    page.getByRole("heading", { name: "Waiting for your approval" }),
  ).toBeVisible();
  await expect(page.locator(".mcp-approvals pre")).toContainText(
    '"text":"Hello"',
  );
  await page.getByRole("button", { name: "Approve once" }).click();
  await expect(page.getByRole("button", { name: "Approve once" })).toHaveCount(
    0,
  );
  await page.locator(".mcp-audit summary").click();
  await expect(page.locator(".mcp-audit")).toContainText("succeeded");
  await page.screenshot({
    path: "test-results/settings-mcp.png",
    fullPage: true,
  });
});

test("emergency stop remains available and clears pending approval", async ({
  page,
}) => {
  await fixture(page, true);
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.getByRole("button", { name: "Review tool request" }).click();
  await page.getByRole("button", { name: "Minecraft", exact: true }).click();
  await page.getByRole("button", { name: "Emergency stop tools" }).click();
  await expect(
    page.getByText("Emergency stop is active.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve once" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("integration views preserve drafts, filter tools and fit narrow windows", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(page.locator(".savebar")).toBeHidden();
  await page
    .getByRole("button", { name: "MCP connections", exact: true })
    .click();
  await page.getByLabel("Search fixture tools").fill("not-a-tool");
  await expect(
    page.getByRole("heading", { name: "No matching tools" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page
    .getByLabel("Filter fixture tools by permission")
    .selectOption("ask");
  await expect(
    page.getByRole("heading", { name: "No matching tools" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit connection", exact: true })
    .click();
  await page.getByLabel("Connection name", { exact: true }).fill("Draft name");
  await page.getByRole("button", { name: "Telegram", exact: true }).click();
  await expect(
    page.getByLabel("Connection name", { exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "MCP connections", exact: true })
    .click();
  await expect(page.getByLabel("Connection name", { exact: true })).toHaveValue(
    "Draft name",
  );
  await page
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Permission for fixture/echo")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Telegram", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Telegram plugin" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "MCP connections", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/settings-integrations-narrow.png",
    fullPage: true,
  });
});
