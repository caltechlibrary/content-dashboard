import { assertEquals } from "jsr:@std/assert";
import { loadConfig } from "./config.ts";

const SAMPLE_YAML = `
browser_config:
  stale_days: 30
  very_stale_days: 90
  session_key: cd_session
  website_page_groups: [1, 2]
  research_guide_groups: [3, 4]
  departments: ["Library"]
proxy:
  port: 8080
  libguides:
    base_url: "https://example.invalid/1.2"
    token_url: "https://example.invalid/1.2/oauth/token"
    client_id: "\${TEST_LG_CLIENT_ID}"
    client_secret: "\${TEST_LG_CLIENT_SECRET}"
  cache:
    enabled: true
    ttl_seconds: 3600
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
      assertEquals(cfg.proxy.libguides.client_id, "abc123");
      assertEquals(cfg.proxy.libguides.client_secret, "s3cr3t");
      assertEquals(cfg.proxy.port, 8080);
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
  await withTempConfig(SAMPLE_YAML, async (path) => {
    const cfg = await loadConfig(path);
    assertEquals(cfg.proxy.libguides.client_id, "");
    assertEquals(cfg.proxy.libguides.client_secret, "");
  });
});
