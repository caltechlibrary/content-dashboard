import { LibGuidesConfig } from "./config.ts";

interface CacheConfig {
  enabled: boolean;
  ttl_seconds: number;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

export function makeLibGuides(cfg: LibGuidesConfig, cache: CacheConfig) {
  let tokenCache: TokenCache | null = null;

  async function getToken(): Promise<string> {
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
      const token = await getToken();
      const res = await fetch(`${cfg.base_url}/accounts`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!res.ok) {
        return new Response(`Upstream error: ${res.status}`, { status: res.status });
      }
      const accounts = await res.json();
      // Strip all PII — only id, first_name, last_name pass through
      const safe = accounts.map(
        ({ id, first_name, last_name }: Record<string, unknown>) => ({
          id,
          first_name,
          last_name,
        })
      );
      return Response.json(safe);
    } catch (err) {
      console.error("accounts error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }

  async function handleGuides(params: URLSearchParams): Promise<Response> {
    try {
      const token = await getToken();
      const qs = params.toString();
      const res = await fetch(`${cfg.base_url}/guides${qs ? "?" + qs : ""}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!res.ok) {
        return new Response(`Upstream error: ${res.status}`, { status: res.status });
      }
      const body = await res.arrayBuffer();
      return new Response(body, {
        headers: {
          "Content-Type": res.headers.get("Content-Type") ?? "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      console.error("guides error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }

  return { handleAccounts, handleGuides };
}
