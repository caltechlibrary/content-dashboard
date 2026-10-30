import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { loadConfig } from "./config.ts";

// Captures console.warn so tests with deliberately empty credentials don't
// print the warning while passing.
async function withCapturedWarnings(fn: (warnings: string[]) => Promise<void>) {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    await fn(warnings);
  } finally {
    console.warn = original;
  }
}

const SAMPLE_YAML = `
browser_config:
  stale_days: 30
  very_stale_days: 90
  session_key: cd_session
  website_page_groups: [1, 2]
  research_guide_groups: [3, 4]
  departments: ["Library"]
router:
  port: 8200
  libguides:
    base_url: "https://example.invalid/1.2"
    token_url: "https://example.invalid/1.2/oauth/token"
    client_id: "\${TEST_LG_CLIENT_ID}"
    client_secret: "\${TEST_LG_CLIENT_SECRET}"
  confluence:
    base_url: "https://example.invalid/wiki"
    email: "someone@example.com"
    api_token: "token"
  cache:
    enabled: true
    ttl_seconds: 3600
`;

const SAMPLE_YAML_WITH_DATASET = `
browser_config:
  stale_days: 30
  very_stale_days: 90
  session_key: cd_session
  website_page_groups: [1, 2]
  research_guide_groups: [3, 4]
  departments: ["Library"]
router:
  port: 8200
  libguides:
    base_url: "https://example.invalid/1.2"
    token_url: "https://example.invalid/1.2/oauth/token"
    client_id: "id"
    client_secret: "secret"
  confluence:
    base_url: "https://example.invalid/wiki"
    email: "someone@example.com"
    api_token: "token"
  cache:
    enabled: true
    ttl_seconds: 3600
  dataset:
    base_url: "\${TEST_DATASET_BASE_URL}"
`;

async function withTempConfig(yaml: string, fn: (path: string) => Promise<void>) {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(path, yaml);
  try {
    await fn(path);
  } finally {
    await Deno.remove(path);
  }
}

Deno.test("loadConfig expands ${VAR} in libguides credentials from the environment", async () => {
  Deno.env.set("TEST_LG_CLIENT_ID", "abc123");
  Deno.env.set("TEST_LG_CLIENT_SECRET", "s3cr3t");
  try {
    await withTempConfig(SAMPLE_YAML, async (path) => {
      const cfg = await loadConfig(path);
      assertEquals(cfg.router.libguides.client_id, "abc123");
      assertEquals(cfg.router.libguides.client_secret, "s3cr3t");
      assertEquals(cfg.router.port, 8200);
      assertEquals(cfg.browser_config.departments, ["Library"]);
    });
  } finally {
    Deno.env.delete("TEST_LG_CLIENT_ID");
    Deno.env.delete("TEST_LG_CLIENT_SECRET");
  }
});

Deno.test("loadConfig leaves unresolved env vars as an empty string", async () => {
  Deno.env.delete("TEST_LG_CLIENT_ID");
  Deno.env.delete("TEST_LG_CLIENT_SECRET");
  await withCapturedWarnings(async (warnings) => {
    await withTempConfig(SAMPLE_YAML, async (path) => {
      const cfg = await loadConfig(path);
      assertEquals(cfg.router.libguides.client_id, "");
      assertEquals(cfg.router.libguides.client_secret, "");
    });
    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0], "are empty");
  });
});

Deno.test("loadConfig defaults dataset.base_url to http://localhost:8201 when absent", async () => {
  await withCapturedWarnings(async () => {
    await withTempConfig(SAMPLE_YAML, async (path) => {
      const cfg = await loadConfig(path);
      assertEquals(cfg.router.dataset.base_url, "http://localhost:8201");
    });
  });
});

Deno.test("loadConfig expands ${VAR} in an explicit dataset.base_url", async () => {
  Deno.env.set("TEST_DATASET_BASE_URL", "http://localhost:9999");
  try {
    await withTempConfig(SAMPLE_YAML_WITH_DATASET, async (path) => {
      const cfg = await loadConfig(path);
      assertEquals(cfg.router.dataset.base_url, "http://localhost:9999");
    });
  } finally {
    Deno.env.delete("TEST_DATASET_BASE_URL");
  }
});

Deno.test("loadConfig expands ${VAR} in confluence credentials, and warns when they are empty", async () => {
  const yaml = SAMPLE_YAML
    .replace('"someone@example.com"', '"${TEST_CF_EMAIL}"')
    .replace('"token"', '"${TEST_CF_API_TOKEN}"');
  Deno.env.set("TEST_LG_CLIENT_ID", "abc123");
  Deno.env.set("TEST_LG_CLIENT_SECRET", "s3cr3t");
  Deno.env.set("TEST_CF_EMAIL", "someone@example.com");
  Deno.env.set("TEST_CF_API_TOKEN", "t0k3n");
  try {
    await withTempConfig(yaml, async (path) => {
      const cfg = await loadConfig(path);
      assertEquals(cfg.router.confluence.email, "someone@example.com");
      assertEquals(cfg.router.confluence.api_token, "t0k3n");
    });

    Deno.env.delete("TEST_CF_EMAIL");
    Deno.env.delete("TEST_CF_API_TOKEN");
    await withCapturedWarnings(async (warnings) => {
      await withTempConfig(yaml, async (path) => {
        const cfg = await loadConfig(path);
        assertEquals(cfg.router.confluence.email, "");
      });
      assertEquals(warnings.length, 1);
      assertStringIncludes(warnings[0], "CONFLUENCE_EMAIL/CONFLUENCE_API_TOKEN are empty");
    });
  } finally {
    Deno.env.delete("TEST_LG_CLIENT_ID");
    Deno.env.delete("TEST_LG_CLIENT_SECRET");
    Deno.env.delete("TEST_CF_EMAIL");
    Deno.env.delete("TEST_CF_API_TOKEN");
  }
});
