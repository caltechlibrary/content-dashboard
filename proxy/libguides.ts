import { CacheConfig, LibGuidesConfig } from "./config.ts";

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

// Fields kept from a LibGuides account — applied to /accounts entries and to
// any guide/page owner accounts embedded via /guides?expand=...,owner.
function stripAccount(account: unknown): Record<string, unknown> | null {
  if (!account || typeof account !== "object") return null;
  const a = account as Record<string, unknown>;
  return { id: a.id, first_name: a.first_name, last_name: a.last_name };
}

function stripGuide(guide: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...guide };
  if ("owner" in safe) {
    safe.owner = stripAccount(safe.owner);
  }
  if (Array.isArray(safe.pages)) {
    safe.pages = safe.pages.map((page) => {
      if (page && typeof page === "object" && "owner" in (page as Record<string, unknown>)) {
        const p = page as Record<string, unknown>;
        return { ...p, owner: stripAccount(p.owner) };
      }
      return page;
    });
  }
  return safe;
}

export function makeLibGuides(cfg: LibGuidesConfig, cache: CacheConfig) {
  let tokenCache: TokenCache | null = null;
  const responseCache = new Map<string, CacheEntry>();

  function fromCache(key: string): unknown {
    if (!cache.enabled) return undefined;
    const entry = responseCache.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      responseCache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  function toCache(key: string, data: unknown): void {
    if (!cache.enabled) return;
    responseCache.set(key, { data, expiresAt: Date.now() + cache.ttl_seconds * 1000 });
  }

  async function getToken(): Promise<string> {
    if (!cfg.client_id || !cfg.client_secret) {
      throw new Error(
        "LibGuides credentials are not configured (LIBGUIDES_CLIENT_ID/LIBGUIDES_CLIENT_SECRET " +
          "are empty — check that .env exists and is loaded; see DEPLOYMENT.md)",
      );
    }
    if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    const res = await fetch(cfg.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        grant_type: "client_credentials",
      }),
    });
    if (!res.ok) {
      throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return tokenCache.token;
  }

  async function handleAccounts(): Promise<Response> {
    try {
      const cached = fromCache("accounts");
      if (cached !== undefined) return Response.json(cached);

      const token = await getToken();
      const res = await fetch(`${cfg.base_url}/accounts`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!res.ok) {
        return new Response(`Upstream error: ${res.status}`, { status: res.status });
      }
      const accounts = await res.json();
      // Strip all PII — only id, first_name, last_name pass through
      const safe = accounts.map((a: Record<string, unknown>) => stripAccount(a));
      toCache("accounts", safe);
      return Response.json(safe);
    } catch (err) {
      console.error("accounts error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }

  async function handleGuides(params: URLSearchParams): Promise<Response> {
    try {
      const qs = params.toString();
      const cacheKey = `guides?${qs}`;
      const cached = fromCache(cacheKey);
      if (cached !== undefined) {
        return Response.json(cached, { headers: { "Cache-Control": "no-store" } });
      }

      const token = await getToken();
      const res = await fetch(`${cfg.base_url}/guides${qs ? "?" + qs : ""}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!res.ok) {
        return new Response(`Upstream error: ${res.status}`, { status: res.status });
      }
      const guides = await res.json();
      // Strip PII from embedded owner accounts — same fields as handleAccounts
      const safe = Array.isArray(guides)
        ? guides.map((g: Record<string, unknown>) => stripGuide(g))
        : guides;
      toCache(cacheKey, safe);
      return Response.json(safe, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      console.error("guides error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }

  return { handleAccounts, handleGuides };
}
