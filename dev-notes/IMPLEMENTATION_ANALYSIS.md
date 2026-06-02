# Content Dashboard: Implementation Analysis

**Date**: 2026-05-29  
**Status**: Planning complete; implementation ready to begin  
**Prerequisite reading**: STRUCTURAL_ANALYSIS.md, MIGRATION_PLAN.md

---

## Current Repository State

| Item | Status | Notes |
|------|--------|-------|
| `htdocs/` with browser files | ✅ Done | `app.js`, `index.html`, `styles.css` |
| `worker.js` at root | ✅ Done | Reference copy; delete post-migration |
| `config.js` at root | ✅ Done | Old JS format; content merges into YAML then delete |
| `content_dashboard.yaml` (datasetd) | ✅ Done | Schemas and collections complete |
| `content_dashboard.yaml` (browser_config) | ❌ Missing | Must add |
| `content_dashboard.yaml` (proxy section) | ❌ Missing | Must add |
| `htdocs/app.js` — WORKER_URL references | ❌ 12 locations | All must be replaced |
| Deno proxy service | ❌ Not started | 4 endpoints required |
| `.wrangler/` directory | ❌ Remove | Cloudflare deployment state |
| `stewardship.json` at root | ❌ Remove after migration | Data is now in `stewardship.ds` |

---

## Work Packages

Three parallel work packages. They can be developed independently and integrated at the end.

```
Work Package 1: content_dashboard.yaml additions
Work Package 2: htdocs/app.js migration
Work Package 3: Deno proxy service
```

---

## Work Package 1: content_dashboard.yaml Additions

Add two sections to the existing `content_dashboard.yaml`.

### 1a. browser_config section

This replaces `config.js`. The Deno proxy reads these values and serves them
via `GET /api/config` as JSON.

```yaml
# Browser-facing configuration — served by the Deno proxy at GET /api/config
browser_config:
  stale_days: 365
  very_stale_days: 730
  session_key: "cs_guides_v1"
  website_page_groups: [26856, 27077]
  research_guide_groups: [10729]
  departments:
    - "Archives"
    - "ACS"
    - "CLOPS"
    - "DLD"
    - "LIT"
    - "RS"
```

### 1b. proxy section

Runtime configuration for the Deno proxy. Credentials come from environment
variables — never hardcoded.

```yaml
# Deno backend proxy configuration
proxy:
  port: 8080
  libguides:
    base_url: "https://lgapi-us.libapps.com/1.2"
    token_url: "https://lgapi-us.libapps.com/1.2/oauth/token"
    client_id: "${LIBGUIDES_CLIENT_ID}"
    client_secret: "${LIBGUIDES_CLIENT_SECRET}"
  cache:
    enabled: true
    ttl_seconds: 3600
```

### 1c. Cleanup after YAML merge

Once the YAML is updated:

- Delete `config.js` from root (content fully absorbed)
- Remove `.wrangler/` directory (Cloudflare deployment state, not needed)
- Add `.wrangler/` to `.gitignore` if not already present

---

## Work Package 2: htdocs/app.js Migration

All 12 `CONFIG.WORKER_URL` references must be replaced. The approach changes in
two ways:

1. `CONFIG` is no longer a compile-time constant — it is fetched from
   `GET /api/config` at page load. A `loadConfig()` function must be added and
   called before any other data fetch.

2. The browser now speaks to two distinct URL roots:
   - **datasetd** (stewardship + audit CRUD): relative path, same origin
   - **Deno proxy** (LibGuides + whoami + config): relative path, same origin
   
   In production both go through Apache at `apps.library.caltech.edu/content-dashboard`.
   In development a small gitignored `htdocs/dev-config.js` can override the
   base URL constants.

### 2a. New loadConfig() (call first, before loadData)

**Add to app.js** — replaces the static `const CONFIG = { ... }` that was
in `config.js`:

```javascript
let CONFIG = {};

async function loadConfig() {
  const res = await fetch('/content-dashboard/api/config');
  if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
  CONFIG = await res.json();
}
```

Development override pattern (gitignored `htdocs/dev-config.js`):
```javascript
// htdocs/dev-config.js  — gitignored, development only
window.__DEV_CONFIG__ = {
  apiBase: 'http://localhost:8080',   // Deno proxy
  datasetBase: 'http://localhost:8200' // datasetd
};
```

`loadConfig()` merges `window.__DEV_CONFIG__` when present.

### 2b. New loadCurrentUser() (call at page load, store in CONFIG.currentUser)

```javascript
async function loadCurrentUser() {
  try {
    const res = await fetch(`${CONFIG.apiBase ?? ''}/content-dashboard/api/whoami`);
    if (res.ok) {
      const data = await res.json();
      CONFIG.currentUser = data.user || 'unknown';
    }
  } catch {
    CONFIG.currentUser = 'unknown';
  }
}
```

### 2c. app.js — all 12 change points

#### Change 1 — `syncAudit()` line 146: GET audit from KV → datasetd keys + objects

**Old:**
```javascript
const ar = await fetch(`${CONFIG.WORKER_URL}/audit`);
if (ar.ok) {
  const entries = await ar.json();
  const kvAudit = {};
  for (const { key, value } of entries) {
    if (value) kvAudit[key] = value;
  }
  state.audit = { ...state.audit, ...kvAudit };
  localStorage.setItem('audit_cache', JSON.stringify(state.audit));
}
```

**New:**
```javascript
const base = CONFIG.datasetBase ?? '';
const keysRes = await fetch(`${base}/content-dashboard/api/audit.ds/keys`);
if (keysRes.ok) {
  const keys = await keysRes.json();
  const fresh = {};
  await Promise.all(keys.map(async key => {
    const r = await fetch(
      `${base}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`
    );
    if (r.ok) fresh[key] = await r.json();
  }));
  state.audit = { ...state.audit, ...fresh };
  localStorage.setItem('audit_cache', JSON.stringify(state.audit));
}
```

#### Change 2 — `clearAuditField()` line 193: PUT audit to KV → PUT to datasetd

**Old:**
```javascript
return fetch(`${CONFIG.WORKER_URL}/audit`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type, id, checks: state.audit[key] }),
});
```

**New:**
```javascript
const base = CONFIG.datasetBase ?? '';
return fetch(
  `${base}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`,
  {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type, id, ...state.audit[key], updatedBy: CONFIG.currentUser
    }),
  }
);
```

#### Change 3 — `saveAuditCheck()` line 208: PUT audit to KV → PUT to datasetd

**Old:**
```javascript
await fetch(`${CONFIG.WORKER_URL}/audit`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type, id, checks: current }),
});
```

**New:**
```javascript
const base = CONFIG.datasetBase ?? '';
await fetch(
  `${base}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`,
  {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, id, ...current, updatedBy: CONFIG.currentUser }),
  }
);
```

#### Changes 4–6 — `loadData()` lines 323–342: stewardship load + seeding

**Old (lines 322–345):**
```javascript
// Load stewardship from KV; if empty, seed from stewardship.json
try {
  const sr = await fetch(`${CONFIG.WORKER_URL}/stewardship`);
  if (sr.ok) {
    const kvData = await sr.json();
    if (Object.keys(kvData).length > 0) {
      state.stewardship = kvData;
    } else {
      // KV is empty — seed from stewardship.json
      const jr = await fetch('stewardship.json?_=' + Date.now());
      if (jr.ok) {
        const jsonData = await jr.json();
        state.stewardship = jsonData;
        await Promise.all(Object.entries(jsonData).map(([pageId, entry]) =>
          fetch(`${CONFIG.WORKER_URL}/stewardship`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageId, expert: entry.expert || '',
              editor: entry.editor || '', department: entry.department || '' }),
          })
        ));
      }
    }
  }
} catch { /* stewardship stays empty */ }
```

**New (seeding removed — data lives in stewardship.ds from migration):**
```javascript
try {
  const base = CONFIG.datasetBase ?? '';
  const keysRes = await fetch(
    `${base}/content-dashboard/api/stewardship.ds/keys`
  );
  if (keysRes.ok) {
    const keys = await keysRes.json();
    const result = {};
    await Promise.all(keys.map(async key => {
      const r = await fetch(
        `${base}/content-dashboard/api/stewardship.ds/object/${encodeURIComponent(key)}`
      );
      if (r.ok) result[key] = await r.json();
    }));
    state.stewardship = result;
  }
} catch { /* stewardship stays empty */ }
```

#### Change 7 — `loadData()` line 349: GET accounts → Deno proxy

**Old:**
```javascript
const ar = await fetch(`${CONFIG.WORKER_URL}/accounts`);
if (ar.ok) {
  const accounts = await ar.json();
  state.names = accounts
    .filter(a => {
      if (!a.first_name && !a.last_name) return false;
      const email = (a.email || '').toLowerCase();
      if (email.endsWith('@springshare.com')) return false;
      if ((a.last_name || '').includes('(test)')) return false;
      if (email.includes('+')) return false;
      return true;
    })
    ...
```

**New** (email filters removed — proxy strips PII including email; only `(test)` filter
is functional since `email` is never present in the proxy response):
```javascript
const apiBase = CONFIG.apiBase ?? '';
const ar = await fetch(`${apiBase}/content-dashboard/api/libguides/accounts`);
if (ar.ok) {
  const accounts = await ar.json();
  state.names = accounts
    .filter(a => {
      if (!a.first_name && !a.last_name) return false;
      if ((a.last_name || '').includes('(test)')) return false;
      return true;
    })
    .map(a => `${a.first_name} ${a.last_name}`.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
```

#### Change 8 — `loadData()` line 374: GET audit from KV → datasetd

**Old:**
```javascript
const ar = await fetch(`${CONFIG.WORKER_URL}/audit`);
if (ar.ok) {
  const entries = await ar.json();
  const kvAudit = {};
  for (const { key, value } of entries) {
    if (value) kvAudit[key] = value;
  }
  state.audit = { ...state.audit, ...kvAudit };
  localStorage.setItem('audit_cache', JSON.stringify(state.audit));
}
```

**New** (same pattern as Change 1):
```javascript
const base = CONFIG.datasetBase ?? '';
const keysRes = await fetch(`${base}/content-dashboard/api/audit.ds/keys`);
if (keysRes.ok) {
  const keys = await keysRes.json();
  const fresh = {};
  await Promise.all(keys.map(async key => {
    const r = await fetch(
      `${base}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`
    );
    if (r.ok) fresh[key] = await r.json();
  }));
  state.audit = { ...state.audit, ...fresh };
  localStorage.setItem('audit_cache', JSON.stringify(state.audit));
}
```

#### Change 9 — `loadData()` line 402: GET guides (published) → Deno proxy

**Old:**
```javascript
const res = await fetch(
  `${CONFIG.WORKER_URL}/guides?status=1&expand=pages,pages.boxes,owner`
);
```

**New:**
```javascript
const apiBase = CONFIG.apiBase ?? '';
const res = await fetch(
  `${apiBase}/content-dashboard/api/libguides/guides?status=1&expand=pages,pages.boxes,owner`
);
```

#### Change 10 — `runUnpublishedReport()` line 1203: GET guides (unpublished) → Deno proxy

**Old:**
```javascript
const res = await fetch(
  `${CONFIG.WORKER_URL}/guides?status=0&expand=pages,owner`
);
```

**New:**
```javascript
const apiBase = CONFIG.apiBase ?? '';
const res = await fetch(
  `${apiBase}/content-dashboard/api/libguides/guides?status=0&expand=pages,owner`
);
```

#### Change 11 — `runRgUnpublishedReport()` line 1286: GET guides (unpublished RG) → Deno proxy

**Old:**
```javascript
const res = await fetch(
  `${CONFIG.WORKER_URL}/guides?status=0&expand=pages,owner`
);
```

**New:**
```javascript
const apiBase = CONFIG.apiBase ?? '';
const res = await fetch(
  `${apiBase}/content-dashboard/api/libguides/guides?status=0&expand=pages,owner`
);
```

#### Change 12 — inline stewardship save line 1486: PUT to KV → PUT to datasetd

**Old:**
```javascript
fetch(`${CONFIG.WORKER_URL}/stewardship`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pageId, expert: entry.expert || '', editor: entry.editor || '',
    department: entry.department || ''
  }),
});
```

**New:**
```javascript
const base = CONFIG.datasetBase ?? '';
fetch(
  `${base}/content-dashboard/api/stewardship.ds/object/${encodeURIComponent(pageId)}`,
  {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageId,
      expert: entry.expert || '',
      editor: entry.editor || '',
      department: entry.department || '',
      updatedBy: CONFIG.currentUser,
    }),
  }
);
```

### 2d. Page load sequence change

The DOMContentLoaded handler currently calls `loadData()` directly. It must
be updated to:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadCurrentUser();
  await loadData();
});
```

---

## Work Package 3: Deno Proxy Service

### File layout

```
content-dashboard/
├── proxy/
│   ├── main.ts          # Entry point
│   ├── config.ts        # YAML config loader
│   ├── libguides.ts     # OAuth token management + LibGuides proxy handlers
│   └── routes.ts        # Router setup
```

### Endpoints

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/content-dashboard/api/config` | `handleConfig` | Returns `browser_config` from YAML as JSON |
| GET | `/content-dashboard/api/whoami` | `handleWhoami` | Reads `Remote-User` header; falls back to `DEV_USER` env var |
| GET | `/content-dashboard/api/libguides/accounts` | `handleAccounts` | OAuth proxy; strips all PII except `id`, `first_name`, `last_name` |
| GET | `/content-dashboard/api/libguides/guides` | `handleGuides` | OAuth proxy; passes `status` + `expand` query params through |
| GET | `/content-dashboard/api/health` | `handleHealth` | Liveness check |

### config.ts — YAML loader

```typescript
import { parse } from "jsr:@std/yaml";

export interface BrowserConfig {
  stale_days: number;
  very_stale_days: number;
  session_key: string;
  website_page_groups: number[];
  research_guide_groups: number[];
  departments: string[];
}

export interface LibGuidesConfig {
  base_url: string;
  token_url: string;
  client_id: string;
  client_secret: string;
}

export interface ProxyConfig {
  port: number;
  libguides: LibGuidesConfig;
  cache: { enabled: boolean; ttl_seconds: number };
}

export interface AppConfig {
  browser_config: BrowserConfig;
  proxy: ProxyConfig;
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const raw = await Deno.readTextFile(path);
  const cfg = parse(raw) as AppConfig;
  // Expand environment variable placeholders in LibGuides credentials
  const lg = cfg.proxy.libguides;
  lg.client_id     = expandEnv(lg.client_id);
  lg.client_secret = expandEnv(lg.client_secret);
  return cfg;
}

function expandEnv(val: string): string {
  return val.replace(/\$\{([^}]+)\}/g, (_, k) => Deno.env.get(k) ?? '');
}
```

### main.ts — entry point

```typescript
import { loadConfig } from "./config.ts";
import { buildRouter }  from "./routes.ts";

const configPath = Deno.args[0] ?? "../content_dashboard.yaml";
const cfg = await loadConfig(configPath);

const router = buildRouter(cfg);
const port   = cfg.proxy.port;

console.log(`Proxy listening on :${port}`);
Deno.serve({ port }, router);
```

### routes.ts — handler wiring

```typescript
import { AppConfig }     from "./config.ts";
import { makeLibGuides } from "./libguides.ts";

export function buildRouter(cfg: AppConfig) {
  const lg = makeLibGuides(cfg.proxy.libguides, cfg.proxy.cache);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p   = url.pathname;

    if (p === "/content-dashboard/api/config")
      return Response.json(cfg.browser_config);

    if (p === "/content-dashboard/api/whoami")
      return handleWhoami(req);

    if (p === "/content-dashboard/api/health")
      return Response.json({ status: "ok" });

    if (p === "/content-dashboard/api/libguides/accounts")
      return lg.handleAccounts();

    if (p === "/content-dashboard/api/libguides/guides")
      return lg.handleGuides(url.searchParams);

    return new Response("Not found", { status: 404 });
  };
}

function handleWhoami(req: Request): Response {
  const user =
    req.headers.get("Remote-User") ??
    req.headers.get("remote-user") ??
    Deno.env.get("DEV_USER") ??
    "dev-user";
  return Response.json({ user });
}
```

### libguides.ts — OAuth + proxy handlers

```typescript
import { LibGuidesConfig } from "./config.ts";

interface CacheConfig { enabled: boolean; ttl_seconds: number }

interface TokenCache { token: string; expiresAt: number }

export function makeLibGuides(cfg: LibGuidesConfig, cache: CacheConfig) {
  let tokenCache: TokenCache | null = null;

  async function getToken(): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    const res = await fetch(cfg.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     cfg.client_id,
        client_secret: cfg.client_secret,
        grant_type:    "client_credentials",
      }),
    });
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
    const data = await res.json();
    tokenCache = {
      token:     data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return tokenCache.token;
  }

  async function handleAccounts(): Promise<Response> {
    const token    = await getToken();
    const res      = await fetch(`${cfg.base_url}/accounts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return new Response("Upstream error", { status: res.status });
    const accounts = await res.json();
    // Strip all PII — only id, first_name, last_name
    const safe = accounts.map(
      ({ id, first_name, last_name }: Record<string, unknown>) =>
        ({ id, first_name, last_name })
    );
    return Response.json(safe);
  }

  async function handleGuides(params: URLSearchParams): Promise<Response> {
    const token = await getToken();
    const qs    = params.toString();
    const res   = await fetch(`${cfg.base_url}/guides${qs ? "?" + qs : ""}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return new Response("Upstream error", { status: res.status });
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  return { handleAccounts, handleGuides };
}
```

### deno.json additions

Add a `proxy` task alongside the existing `gen-code` task:

```json
{
  "tasks": {
    "gen-code": "deno run --allow-read --allow-write ./cmt.ts codemeta.json about.md CITATION.cff version.ts",
    "proxy":    "deno run --allow-net --allow-env --allow-read proxy/main.ts content_dashboard.yaml",
    "proxy-dev": "DEV_USER=dev-user deno run --allow-net --allow-env --allow-read proxy/main.ts content_dashboard.yaml"
  }
}
```

---

## Cleanup Tasks

Once Work Packages 1–3 are complete and tested:

| Task | Command / Action |
|------|-----------------|
| Delete `config.js` from root | `git rm config.js` |
| Remove `.wrangler/` | `git rm -r .wrangler` |
| Add `.wrangler` to `.gitignore` | Edit `.gitignore` |
| Delete `wrangler.toml` | `git rm wrangler.toml` (after migration verified) |
| Delete `worker.js` | `git rm worker.js` (after migration verified) |
| Delete `stewardship.json` | `git rm stewardship.json` (after `stewardship.ds` loaded) |
| Delete `stewardship.jsonl` | `git rm stewardship.jsonl` |

---

## Development Workflow

```bash
# Terminal 1 — datasetd
datasetd content_dashboard.yaml

# Terminal 2 — Deno proxy
LIBGUIDES_CLIENT_ID=xxx LIBGUIDES_CLIENT_SECRET=yyy deno task proxy-dev

# Browser
open http://localhost:8200/
```

Apache is not needed in development. The browser talks directly to datasetd
(:8200 for static files + dataset API) and the Deno proxy (:8080 for LibGuides
+ whoami + config). The `htdocs/dev-config.js` (gitignored) sets the base URLs:

```javascript
// htdocs/dev-config.js — gitignored
window.__DEV_CONFIG__ = {
  apiBase:     'http://localhost:8080',
  datasetBase: 'http://localhost:8200',
};
```

---

## Open Items Before Starting Implementation

| # | Item | Owner | Blocking? |
|---|------|-------|-----------|
| 1 | Confirm datasetd version on dev machine supports `schemas:` + `validate:` | Developer | Yes — test before writing app.js |
| 2 | Confirm `generator: "now"` auto-timestamps work in this datasetd version | Developer | Yes — affects whether app.js sets timestamps or datasetd does |
| 3 | Get LibGuides `client_id` and `client_secret` for development | LibGuides admin | Yes — needed for proxy testing |
| 4 | Confirm `codemeta.json`/`CITATION.cff` metadata is current before cleanup commits | Developer | No |

---

*Created: 2026-05-29*  
*Status: Ready for implementation*
