import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
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
  router: {
    port: 8200,
    libguides: {
      base_url: "https://example.invalid/1.2",
      token_url: "https://example.invalid/1.2/oauth/token",
      client_id: "id",
      client_secret: "secret",
    },
    cache: { enabled: false, ttl_seconds: 3600 },
    dataset: { base_url: "http://example.invalid" },
  },
};

function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input);
}

async function withFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    handler(urlOf(input), init)) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("GET /api/config returns browser_config", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/api/config"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), cfg.browser_config);
});

Deno.test("GET /api/health returns ok status", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/api/health"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ok");
});

Deno.test("GET /api/whoami uses the Remote-User header when present", async () => {
  const router = buildRouter(cfg);
  const res = await router(
    new Request("http://localhost/api/whoami", {
      headers: { "Remote-User": "jdoe@caltech.edu" },
    }),
  );
  assertEquals(await res.json(), { user: "jdoe@caltech.edu" });
});

Deno.test("GET /api/whoami falls back to DEV_USER, then dev-user", async () => {
  const router = buildRouter(cfg);
  const before = Deno.env.get("DEV_USER");
  try {
    Deno.env.delete("DEV_USER");
    let res = await router(new Request("http://localhost/api/whoami"));
    assertEquals(await res.json(), { user: "dev-user" });

    Deno.env.set("DEV_USER", "tester");
    res = await router(new Request("http://localhost/api/whoami"));
    assertEquals(await res.json(), { user: "tester" });
  } finally {
    if (before === undefined) {
      Deno.env.delete("DEV_USER");
    } else {
      Deno.env.set("DEV_USER", before);
    }
  }
});

Deno.test("GET /lg/api/accounts proxies to LibGuides and strips PII", async () => {
  await withFetch(async (url) => {
    if (url === cfg.router.libguides.token_url) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url === `${cfg.router.libguides.base_url}/accounts`) {
      return new Response(
        JSON.stringify([
          { id: 1, first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const router = buildRouter(cfg);
    const res = await router(new Request("http://localhost/lg/api/accounts"));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), [{ id: 1, first_name: "Ada", last_name: "Lovelace" }]);
  });
});

Deno.test("GET /lg/api/guides forwards query params to LibGuides", async () => {
  let guidesUrl = "";
  await withFetch(async (url) => {
    if (url === cfg.router.libguides.token_url) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url.startsWith(`${cfg.router.libguides.base_url}/guides`)) {
      guidesUrl = url;
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const router = buildRouter(cfg);
    const res = await router(
      new Request("http://localhost/lg/api/guides?status=1&expand=pages,owner"),
    );
    assertEquals(res.status, 200);
    assertEquals(
      guidesUrl,
      `${cfg.router.libguides.base_url}/guides?status=1&expand=pages%2Cowner`,
    );
  });
});

Deno.test("GET /ds/api/stewardship.ds/keys proxies to the dataset base_url", async () => {
  let calledUrl = "";
  await withFetch(async (url) => {
    calledUrl = url;
    return new Response(JSON.stringify(["key1", "key2"]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const router = buildRouter(cfg);
    const res = await router(
      new Request("http://localhost/ds/api/stewardship.ds/keys"),
    );
    assertEquals(res.status, 200);
    assertEquals(calledUrl, `${cfg.router.dataset.base_url}/api/stewardship.ds/keys`);
    assertEquals(await res.json(), ["key1", "key2"]);
  });
});

Deno.test("GET / serves htdocs/index.html", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/"));
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body.toLowerCase(), "<!doctype html");
});

Deno.test("GET /styles.css serves the stylesheet", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/styles.css"));
  assertEquals(res.status, 200);
});

Deno.test("GET /nonexistent.xyz returns 404", async () => {
  const router = buildRouter(cfg);
  const res = await router(new Request("http://localhost/nonexistent.xyz"));
  assertEquals(res.status, 404);
});
