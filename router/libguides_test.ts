import { assertEquals } from "jsr:@std/assert";
import { makeLibGuides } from "./libguides.ts";
import type { LibGuidesConfig } from "./config.ts";

const cfg: LibGuidesConfig = {
  base_url: "https://example.invalid/1.2",
  token_url: "https://example.invalid/1.2/oauth/token",
  client_id: "id",
  client_secret: "secret",
};

const cacheOn = { enabled: true, ttl_seconds: 3600 };
const cacheOff = { enabled: false, ttl_seconds: 3600 };

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

Deno.test("handleAccounts strips all but id/first_name/last_name", async () => {
  let tokenCalls = 0;
  await withFetch(async (url) => {
    if (url === cfg.token_url) {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url === `${cfg.base_url}/accounts`) {
      return new Response(
        JSON.stringify([
          { id: 1, first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(cfg, cacheOff);
    const res = await lg.handleAccounts();
    assertEquals(await res.json(), [{ id: 1, first_name: "Ada", last_name: "Lovelace" }]);
    assertEquals(tokenCalls, 1);
  });
});

Deno.test("getToken caches the token across calls within ttl", async () => {
  let tokenCalls = 0;
  let accountsCalls = 0;
  await withFetch(async (url) => {
    if (url === cfg.token_url) {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url === `${cfg.base_url}/accounts`) {
      accountsCalls++;
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(cfg, cacheOff);
    await lg.handleAccounts();
    await lg.handleAccounts();
    assertEquals(tokenCalls, 1);
    assertEquals(accountsCalls, 2);
  });
});

Deno.test("handleAccounts proxies upstream error status", async () => {
  await withFetch(async (url) => {
    if (url === cfg.token_url) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url === `${cfg.base_url}/accounts`) {
      return new Response("nope", { status: 503 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(cfg, cacheOff);
    const res = await lg.handleAccounts();
    assertEquals(res.status, 503);
    assertEquals(await res.text(), "Upstream error: 503");
  });
});

Deno.test("handleAccounts returns 500 if the token request fails", async () => {
  await withFetch(async (url) => {
    if (url === cfg.token_url) {
      return new Response("bad creds", { status: 401 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(cfg, cacheOff);
    const res = await lg.handleAccounts();
    assertEquals(res.status, 500);
    assertEquals(await res.text(), "Internal error");
  });
});

Deno.test("handleAccounts returns 500 without calling fetch when LibGuides credentials are empty", async () => {
  const emptyCfg: LibGuidesConfig = { ...cfg, client_id: "", client_secret: "" };
  await withFetch(async (url) => {
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(emptyCfg, cacheOff);
    const res = await lg.handleAccounts();
    assertEquals(res.status, 500);
    assertEquals(await res.text(), "Internal error");
  });
});

Deno.test("handleGuides forwards query params, sets Cache-Control: no-store, and strips owner PII", async () => {
  let guidesUrl = "";
  await withFetch(async (url) => {
    if (url === cfg.token_url) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url.startsWith(`${cfg.base_url}/guides`)) {
      guidesUrl = url;
      return new Response(
        JSON.stringify([
          {
            id: 10,
            title: "My Guide",
            owner: { id: 1, first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
            pages: [
              {
                id: 100,
                name: "Page 1",
                owner: { id: 2, first_name: "Bob", last_name: "Smith", email: "bob@example.com" },
              },
              { id: 101, name: "Page 2" },
            ],
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(cfg, cacheOff);
    const params = new URLSearchParams({ status: "1", expand: "pages,owner" });
    const res = await lg.handleGuides(params);
    assertEquals(guidesUrl, `${cfg.base_url}/guides?status=1&expand=pages%2Cowner`);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    assertEquals(await res.json(), [
      {
        id: 10,
        title: "My Guide",
        owner: { id: 1, first_name: "Ada", last_name: "Lovelace" },
        pages: [
          { id: 100, name: "Page 1", owner: { id: 2, first_name: "Bob", last_name: "Smith" } },
          { id: 101, name: "Page 2" },
        ],
      },
    ]);
  });
});

Deno.test("handleAccounts and handleGuides cache responses when cache.enabled is true", async () => {
  let tokenCalls = 0;
  let accountsCalls = 0;
  let guidesCalls = 0;
  await withFetch(async (url) => {
    if (url === cfg.token_url) {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url === `${cfg.base_url}/accounts`) {
      accountsCalls++;
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.startsWith(`${cfg.base_url}/guides`)) {
      guidesCalls++;
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(cfg, cacheOn);
    const params = new URLSearchParams({ status: "1" });

    await lg.handleAccounts();
    await lg.handleAccounts();
    await lg.handleGuides(params);
    await lg.handleGuides(params);

    assertEquals(tokenCalls, 1);
    assertEquals(accountsCalls, 1);
    assertEquals(guidesCalls, 1);
  });
});

Deno.test("handleGuides does not cache across different query strings", async () => {
  let guidesCalls = 0;
  await withFetch(async (url) => {
    if (url === cfg.token_url) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url.startsWith(`${cfg.base_url}/guides`)) {
      guidesCalls++;
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const lg = makeLibGuides(cfg, cacheOn);
    await lg.handleGuides(new URLSearchParams({ status: "1" }));
    await lg.handleGuides(new URLSearchParams({ status: "0" }));
    assertEquals(guidesCalls, 2);
  });
});
