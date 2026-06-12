import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { makeDatasetProxy } from "./dataset.ts";

const BASE_URL = "http://example.invalid";

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

Deno.test("rewrites /ds/<rest> to <base_url>/<rest>", async () => {
  let calledUrl = "";
  await withFetch(async (url) => {
    calledUrl = url;
    return new Response("[]", { status: 200 });
  }, async () => {
    const proxy = makeDatasetProxy(BASE_URL);
    const req = new Request("http://localhost/ds/api/stewardship.ds/keys");
    const res = await proxy(req, "/ds/api/stewardship.ds/keys");
    assertEquals(res.status, 200);
    assertEquals(calledUrl, `${BASE_URL}/api/stewardship.ds/keys`);
  });
});

Deno.test("rewrites /ds (no rest) to <base_url>/", async () => {
  let calledUrl = "";
  await withFetch(async (url) => {
    calledUrl = url;
    return new Response("ok", { status: 200 });
  }, async () => {
    const proxy = makeDatasetProxy(BASE_URL);
    const req = new Request("http://localhost/ds");
    await proxy(req, "/ds");
    assertEquals(calledUrl, `${BASE_URL}/`);
  });
});

Deno.test("forwards query string", async () => {
  let calledUrl = "";
  await withFetch(async (url) => {
    calledUrl = url;
    return new Response("[]", { status: 200 });
  }, async () => {
    const proxy = makeDatasetProxy(BASE_URL);
    const req = new Request("http://localhost/ds/api/audit.ds/keys?limit=10&sort=-1");
    await proxy(req, "/ds/api/audit.ds/keys");
    assertEquals(calledUrl, `${BASE_URL}/api/audit.ds/keys?limit=10&sort=-1`);
  });
});

Deno.test("PUT forwards method and body", async () => {
  let calledMethod = "";
  let calledBody = "";
  await withFetch(async (url, init) => {
    calledMethod = init?.method ?? "";
    calledBody = init?.body ? await new Response(init.body as ReadableStream).text() : "";
    return new Response("ok", { status: 200 });
  }, async () => {
    const proxy = makeDatasetProxy(BASE_URL);
    const payload = JSON.stringify({ status: "reviewed" });
    const req = new Request("http://localhost/ds/api/stewardship.ds/object/key1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    await proxy(req, "/ds/api/stewardship.ds/object/key1");
    assertEquals(calledMethod, "PUT");
    assertEquals(calledBody, payload);
  });
});

Deno.test("does not forward host or content-length headers", async () => {
  let forwardedHeaders: Headers | undefined;
  await withFetch(async (_url, init) => {
    forwardedHeaders = new Headers(init?.headers);
    return new Response("ok", { status: 200 });
  }, async () => {
    const proxy = makeDatasetProxy(BASE_URL);
    const req = new Request("http://localhost/ds/api/stewardship.ds/keys", {
      headers: { Host: "localhost", "Content-Length": "0" },
    });
    await proxy(req, "/ds/api/stewardship.ds/keys");
    assertEquals(forwardedHeaders?.has("host"), false);
    assertEquals(forwardedHeaders?.has("content-length"), false);
  });
});

Deno.test("does not forward hop-by-hop response headers", async () => {
  await withFetch(async () => {
    return new Response("ok", {
      status: 200,
      headers: { Connection: "keep-alive", "Content-Type": "text/plain" },
    });
  }, async () => {
    const proxy = makeDatasetProxy(BASE_URL);
    const req = new Request("http://localhost/ds/api/stewardship.ds/keys");
    const res = await proxy(req, "/ds/api/stewardship.ds/keys");
    assertEquals(res.headers.has("connection"), false);
    assertEquals(res.headers.get("content-type"), "text/plain");
  });
});

Deno.test("returns 502 JSON when the upstream is unreachable", async () => {
  await withFetch(async () => {
    throw new Error("connection refused");
  }, async () => {
    const proxy = makeDatasetProxy(BASE_URL);
    const req = new Request("http://localhost/ds/api/stewardship.ds/keys");
    const res = await proxy(req, "/ds/api/stewardship.ds/keys");
    assertEquals(res.status, 502);
    assertNotEquals((await res.json()).error, undefined);
  });
});
