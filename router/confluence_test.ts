import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { makeConfluence } from "./confluence.ts";
import type { ConfluenceConfig } from "./config.ts";

const cfg: ConfluenceConfig = {
  base_url: "https://example.invalid/wiki",
  email: "someone@example.com",
  api_token: "token",
};

const cacheOn = { enabled: true, ttl_seconds: 3600 };
const cacheOff = { enabled: false, ttl_seconds: 3600 };

const SPACES_URL = `${cfg.base_url}/api/v2/spaces?status=current&limit=250`;
const SEARCH_URL = `${cfg.base_url}/rest/api/search`;

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

// Captures console.error so tests that exercise error paths don't print
// stack traces while passing.
async function withCapturedLogs(fn: (logs: string[]) => Promise<void>) {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await fn(logs);
  } finally {
    console.error = original;
  }
}

// Pulls the space key back out of a search URL's CQL, e.g. space="DLD"
function keyFromSearch(url: string): string {
  const cql = new URL(url).searchParams.get("cql") ?? "";
  return cql.match(/space="([^"]+)"/)?.[1] ?? "";
}

function spacesPage(results: unknown[], next?: string): Response {
  return Response.json({ results, _links: next ? { next } : {} });
}

Deno.test("handleSpaces follows next links and returns every space with its page count", async () => {
  const counts: Record<string, number> = { DLD: 199, LIT: 41, ds: 27 };
  let authHeader = "";
  await withFetch(async (url, init) => {
    authHeader = new Headers(init?.headers).get("Authorization") ?? "";
    if (url === SPACES_URL) {
      return spacesPage(
        [{ key: "DLD", name: "Digital Library Development", type: "global" }],
        "/wiki/api/v2/spaces?cursor=abc",
      );
    }
    if (url === "https://example.invalid/wiki/api/v2/spaces?cursor=abc") {
      return spacesPage([
        { key: "LIT", name: "Library Information Technology", type: "global" },
        { key: "ds", name: "How to Use Confluence", type: "global" },
      ]);
    }
    if (url.startsWith(SEARCH_URL)) {
      return Response.json({ totalSize: counts[keyFromSearch(url)] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const cf = makeConfluence(cfg, cacheOff);
    const res = await cf.handleSpaces();
    assertEquals(res.status, 200);
    assertEquals(await res.json(), [
      {
        spaceKey: "DLD",
        spaceName: "Digital Library Development",
        url: "https://example.invalid/wiki/spaces/DLD",
        pageCount: 199,
      },
      {
        spaceKey: "LIT",
        spaceName: "Library Information Technology",
        url: "https://example.invalid/wiki/spaces/LIT",
        pageCount: 41,
      },
      {
        spaceKey: "ds",
        spaceName: "How to Use Confluence",
        url: "https://example.invalid/wiki/spaces/ds",
        pageCount: 27,
      },
    ]);
    assertEquals(authHeader, `Basic ${btoa("someone@example.com:token")}`);
  });
});

Deno.test("handleSpaces leaves out personal spaces", async () => {
  await withFetch(async (url) => {
    if (url === SPACES_URL) {
      return spacesPage([
        { key: "DLD", name: "Digital Library Development", type: "global" },
        { key: "~5b1234", name: "Ada Lovelace", type: "personal" },
      ]);
    }
    if (url.startsWith(SEARCH_URL)) return Response.json({ totalSize: 1 });
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const cf = makeConfluence(cfg, cacheOff);
    const spaces = await (await cf.handleSpaces()).json();
    assertEquals(spaces.map((s: { spaceKey: string }) => s.spaceKey), ["DLD"]);
  });
});

Deno.test("handleSpaces gives a null page count when one lookup fails, and keeps the rest", async () => {
  await withCapturedLogs(async (logs) => {
    await withFetch(async (url) => {
      if (url === SPACES_URL) {
        return spacesPage([
          { key: "DLD", name: "Digital Library Development", type: "global" },
          { key: "LIT", name: "Library Information Technology", type: "global" },
        ]);
      }
      if (url.startsWith(SEARCH_URL)) {
        return keyFromSearch(url) === "LIT"
          ? new Response("nope", { status: 500 })
          : Response.json({ totalSize: 199 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }, async () => {
      const cf = makeConfluence(cfg, cacheOff);
      const spaces = await (await cf.handleSpaces()).json();
      assertEquals(
        spaces.map((s: { pageCount: number | null }) => s.pageCount),
        [199, null],
      );
    });
    assertEquals(logs.length, 1);
    assertStringIncludes(logs[0], "page count error for LIT");
  });
});

Deno.test("handleSpaces passes through the status when the space list request fails", async () => {
  await withCapturedLogs(async () => {
    await withFetch(async (url) => {
      if (url === SPACES_URL) return new Response("unauthorized", { status: 401 });
      throw new Error(`unexpected fetch: ${url}`);
    }, async () => {
      const cf = makeConfluence(cfg, cacheOff);
      const res = await cf.handleSpaces();
      assertEquals(res.status, 401);
      assertEquals(await res.text(), "Upstream error: 401");
    });
  });
});

Deno.test("handleSpaces returns 500 without calling fetch when Confluence credentials are empty", async () => {
  const emptyCfg: ConfluenceConfig = { ...cfg, email: "", api_token: "" };
  await withCapturedLogs(async (logs) => {
    await withFetch(async (url) => {
      throw new Error(`unexpected fetch: ${url}`);
    }, async () => {
      const cf = makeConfluence(emptyCfg, cacheOff);
      const res = await cf.handleSpaces();
      assertEquals(res.status, 500);
      assertEquals(await res.text(), "Internal error");
    });
    assertEquals(logs.length, 1);
    assertStringIncludes(logs[0], "credentials are not configured");
  });
});

Deno.test("handleSpaces caches the list, but not when a page count is missing", async () => {
  let listCalls = 0;
  let failLIT = true;
  await withCapturedLogs(async () => {
    await withFetch(async (url) => {
      if (url === SPACES_URL) {
        listCalls++;
        return spacesPage([
          { key: "LIT", name: "Library Information Technology", type: "global" },
        ]);
      }
      if (url.startsWith(SEARCH_URL)) {
        return failLIT ? new Response("nope", { status: 500 }) : Response.json({ totalSize: 41 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }, async () => {
      const cf = makeConfluence(cfg, cacheOn);
      await cf.handleSpaces(); // count fails, so nothing is cached
      failLIT = false;
      await cf.handleSpaces(); // fetched again, now complete and cached
      await cf.handleSpaces(); // served from cache
      assertEquals(listCalls, 2);
    });
  });
});
