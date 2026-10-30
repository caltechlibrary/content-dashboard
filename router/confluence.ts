import { CacheConfig, ConfluenceConfig } from "./config.ts";

// What the browser gets for each space. Owners are not here — those live in
// confluence.ds and the view matches them up by spaceKey.
export interface Space {
  spaceKey: string;
  spaceName: string;
  url: string;
  // null when the page count lookup for that one space failed
  pageCount: number | null;
}

interface ApiSpace {
  key: string;
  name: string;
  type: string;
}

export function makeConfluence(cfg: ConfluenceConfig, cache: CacheConfig) {
  let cached: { data: Space[]; expiresAt: number } | null = null;
  const base = cfg.base_url.replace(/\/+$/, "");

  // A personal API token is sent as Basic auth, paired with the email of the
  // Atlassian account that created it.
  function headers(): HeadersInit {
    if (!cfg.email || !cfg.api_token) {
      throw new Error(
        "Confluence credentials are not configured (CONFLUENCE_EMAIL/CONFLUENCE_API_TOKEN " +
          "are empty — check that .env exists and is loaded; see DEPLOYMENT.md)",
      );
    }
    return {
      Authorization: `Basic ${btoa(`${cfg.email}:${cfg.api_token}`)}`,
      Accept: "application/json",
    };
  }

  // Confluence hands out the space list a page at a time. Each response
  // links to the next one, and that link starts at the site root
  // (/wiki/api/v2/...), so it is resolved against the base URL.
  async function listSpaces(): Promise<ApiSpace[] | Response> {
    const spaces: ApiSpace[] = [];
    let next: string | null = `${base}/api/v2/spaces?status=current&limit=250`;
    while (next) {
      const res: Response = await fetch(next, { headers: headers() });
      if (!res.ok) {
        console.error(`confluence spaces error: ${res.status} ${await res.text()}`);
        return new Response(`Upstream error: ${res.status}`, { status: res.status });
      }
      const data: { results: ApiSpace[]; _links?: { next?: string } } = await res.json();
      spaces.push(...data.results);
      next = data._links?.next ? new URL(data._links.next, base).href : null;
    }
    return spaces;
  }

  // The space list doesn't include a page count, so ask a search for the
  // total number of pages in the space. One failed lookup gives null rather
  // than failing the whole table.
  async function countPages(key: string): Promise<number | null> {
    const cql = encodeURIComponent(`space="${key}" and type=page`);
    try {
      const res = await fetch(`${base}/rest/api/search?cql=${cql}&limit=1`, {
        headers: headers(),
      });
      if (!res.ok) {
        console.error(`confluence page count error for ${key}: ${res.status}`);
        return null;
      }
      const data = await res.json();
      return typeof data.totalSize === "number" ? data.totalSize : null;
    } catch (err) {
      console.error(`confluence page count error for ${key}:`, err);
      return null;
    }
  }

  async function handleSpaces(): Promise<Response> {
    try {
      if (cache.enabled && cached && Date.now() < cached.expiresAt) {
        return Response.json(cached.data);
      }

      const listed = await listSpaces();
      if (listed instanceof Response) return listed;

      // Personal spaces are named after a person and have nobody to assign
      // as owner, so they're left out. Their keys start with "~".
      const team = listed.filter((s) => s.type !== "personal" && !s.key.startsWith("~"));

      const spaces: Space[] = await Promise.all(team.map(async (s) => ({
        spaceKey: s.key,
        spaceName: s.name,
        url: `${base}/spaces/${encodeURIComponent(s.key)}`,
        pageCount: await countPages(s.key),
      })));

      // Don't hold on to a list with missing counts — try again next time
      if (cache.enabled && spaces.every((s) => s.pageCount !== null)) {
        cached = { data: spaces, expiresAt: Date.now() + cache.ttl_seconds * 1000 };
      }
      return Response.json(spaces);
    } catch (err) {
      console.error("confluence spaces error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }

  return { handleSpaces };
}
