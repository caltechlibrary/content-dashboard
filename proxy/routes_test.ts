import { assertEquals } from "jsr:@std/assert";
import { buildRouter } from "./routes.ts";
import type { AppConfig } from "./config.ts";

const cfg: AppConfig = {
  browser_config: {
    stale_days: 30,
    very_stale_days: 90,
    session_key: "cd_session",
    website_page_groups: [1],
    research_guide_groups: [2],
    departments: ["Library"],
  },
  proxy: {
    port: 8080,
    libguides: {
      base_url: "https://example.invalid/1.2",
      token_url: "https://example.invalid/1.2/oauth/token",
      client_id: "id",
      client_secret: "secret",
    },
    cache: { enabled: true, ttl_seconds: 3600 },
  },
};

Deno.test("GET /content-dashboard/api/config returns browser_config", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/content-dashboard/api/config"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), cfg.browser_config);
});

Deno.test("GET /content-dashboard/api/health returns ok status", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/content-dashboard/api/health"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ok");
});

Deno.test("GET /content-dashboard/api/whoami uses the Remote-User header when present", async () => {
  const router = buildRouter(cfg);
  const res = await router(
    new Request("http://localhost/content-dashboard/api/whoami", {
      headers: { "Remote-User": "jdoe@caltech.edu" },
    }),
  );
  assertEquals(await res.json(), { user: "jdoe@caltech.edu" });
});

Deno.test("GET /content-dashboard/api/whoami falls back to DEV_USER, then dev-user", async () => {
  const router = buildRouter(cfg);
  const before = Deno.env.get("DEV_USER");
  try {
    Deno.env.delete("DEV_USER");
    let res = await router(new Request("http://localhost/content-dashboard/api/whoami"));
    assertEquals(await res.json(), { user: "dev-user" });

    Deno.env.set("DEV_USER", "tester");
    res = await router(new Request("http://localhost/content-dashboard/api/whoami"));
    assertEquals(await res.json(), { user: "tester" });
  } finally {
    if (before === undefined) {
      Deno.env.delete("DEV_USER");
    } else {
      Deno.env.set("DEV_USER", before);
    }
  }
});

Deno.test("unknown path returns 404", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/content-dashboard/api/nope"));
  assertEquals(res.status, 404);
});
