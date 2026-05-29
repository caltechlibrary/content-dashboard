# Content Dashboard: Structural Analysis

## Existing Architecture, Data Flow, and Dataset Migration Requirements

**Project**: Content Dashboard (content-dashboard)  
**Repository**: caltechlibrary/content-dashboard  
**Current Deployment**: https://caltechlibrary.github.io/content-dashboard/  
**Date**: 2026-05-28  
**Purpose**: Detailed analysis of existing structure for dataset migration planning

---

## 📊 EXECUTIVE SUMMARY

This document provides a **detailed structural analysis** of the existing content-dashboard application, identifying:

1. **Where it interacts with Cloudflare K/V store** - All data persistence for stewardship and audit
2. **Where it interacts with LibGuides API** - All external content data fetching
3. **Specific objects and schemas required** - Exact data structures and JSON schemas
4. **Authentication context** - Cloudflare OAuth for LibGuides, Shibboleth for production

**Key Finding**: The application has a **clean separation** between:
- **Browser-based frontend** (static HTML/JS/CSS)
- **Cloudflare Worker backend** (OAuth proxy + K/V storage)
- **External LibGuides API** (content data source)

This separation makes migration to dataset **straightforward**.

---

## 🏗️ COMPONENT ARCHITECTURE

### 1. Current File Structure

```
content-dashboard/
├── index.html          # Main HTML structure with sidebar navigation
├── app.js              # Application logic, state management, rendering (1549 lines)
├── styles.css          # Application styling (18,150 bytes)
├── config.js           # Configuration constants (12 lines)
├── stewardship.json    # Seed data for stewardship (194 lines, 45 entries)
├── worker.js           # Cloudflare Worker - backend logic (190 lines)
└── wrangler.toml       # Cloudflare Worker configuration (10 lines)
```

### 2. Frontend Components (Browser)

#### index.html Structure

**Navigation Sidebar**:

```
┌──────────────────────┐
│ Content Dashboard    │
├──────────────────────┤
│ Views                │
│ ├─ Website Pages     │  ← data-view="my-website-pages"
│ ├─ Research Guides   │  ← data-view="my-research-guides"
│ └─ Reports           │  ← data-view="reports"
│                      │
│ Tools                │
│ ├─ Assign Roles      │  ← data-view="manage-stewards"
│ └─ LibGuides admin   │  ← external link
├──────────────────────┤
│ Refresh button       │
│ Last fetched display │
└──────────────────────┘
```

**Main Content Area**: Dynamic views loaded via JavaScript

- Only one view visible at a time
- Views: `my-website-pages`, `my-research-guides`, `reports`, `manage-stewards`

**Overlays**: Loading spinner and error messages

#### Frontend State Object (app.js)

```javascript
const state = {
  // View state
  view: 'my-website-pages',
  report: 'stale',
  
  // Data state
  pages: [],              // Processed PageRecord[] from LibGuides
  names: [],              // Sorted staff names from /accounts
  guideOptions: [],       // Sorted unique guide titles
  selectedName: '',       // Filter: selected staff name
  
  // K/V Data (from Cloudflare KV via Worker)
  stewardship: {},        // page_id → { expert, editor, department }
  audit: {},              // 'page:{id}'|'guide:{id}' → { links, accessibility, accuracy }
  
  // Filter states
  manageFilters: { guide: '', showAssigned: true, showUnassigned: true },
  wpSort:  { col: 'guide', dir: 'asc' },
  rgSort:  { col: 'guide', dir: 'asc' },
  msSort:  { col: 'guide', dir: 'asc' },
  
  // Report filters
  reportFilters: {
    stale:        { expert: '', olderThan: '' },
    unassigned: { guide: '', missing: 'either' },
    missing:    { guide: '' },
    hidden:     { guide: '' },
    'rg-stale':       { owner: '', olderThan: '' },
    'rg-hidden':      { guide: '' },
    'rg-unpublished': {}
  }
};
```

---

## 🔌 CLOUDFLARE WORKER: K/V STORE INTERACTIONS

### Worker Overview

**File**: `worker.js` (190 lines)

**Purpose**: 

1. **OAuth Proxy** - Authenticate with LibGuides API
2. **K/V Storage** - Persistent storage via Cloudflare KV namespace
3. **PII Filter** - Strip sensitive data from LibGuides responses
4. **CORS Handler** - Add appropriate CORS headers for browser access

### Cloudflare KV Namespace Configuration

**File**: `wrangler.toml`

```toml
name = "restless-sea-ca3c"
main = "worker.js"
compatibility_date = "2024-01-01"

[observability]
enabled = true

[[kv_namespaces]]
binding = "AUDIT"           # This is the namespace name used in code
id = "11c661f3a1634813bea933f737ccee6c"  # Cloudflare KV namespace ID
```

**Secrets** (set via `wrangler secret put`):
- `LIBGUIDES_CLIENT_ID` - OAuth client credentials
- `LIBGUIDES_CLIENT_SECRET` - OAuth client secret
- `GITHUB_TOKEN` - GitHub PAT (for repo access)

**Vars** (can be set in wrangler.toml):
- `GITHUB_OWNER` = 'caltechlibrary'
- `GITHUB_REPO` = 'content-dashboard'

> **⚠️ Unused config note**: `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO` are declared in `wrangler.toml` and `config.js` but `worker.js` has no handler that uses any GitHub API endpoint. This appears to be dead configuration (likely from a planned or removed feature). These should be cleaned up and not carried forward into the migration.

### K/V Data Structure 1: Stewardship

**Namespace**: `AUDIT` (binding name in worker.js)

**Key Pattern**: `steward:{pageId}`

**Example Keys**:

- `steward:8997487`
- `steward:8997489`
- `steward:9007056`
- ... (45 entries from stewardship.json)

**Value Structure**:

```json
{
  "expert": "Tony Diaz",
  "editor": "Penny Neder-Muro",
  "department": "Archives"
}
```

**Field Definitions**:

- `expert` (string): Content expert name, can be empty string `""`
- `editor` (string): Content editor name, can be empty string `""`
- `department` (string): Department code, can be empty string `""` or undefined

**Valid Department Values** (from config.js):

```javascript
['Archives', 'ACS', 'CLOPS', 'DLD', 'LIT', 'RS']
```

**Frontend Unassigned Detection** (app.js):

```javascript
const UNASSIGNED_RE = /^(tbd|please add|--|n\/a|none|placeholder|add name)$/i;
const DIVISION_CODE_RE = /^\x28[A-Z]{1,6}\x29$/;  // Matches (ABCDE)

function isUnassigned(val) {
  if (!val || val.trim() === '') return true;
  const v = val.trim();
  return UNASSIGNED_RE.test(v) || DIVISION_CODE_RE.test(v);
}
```

### K/V Data Structure 2: Audit

**Key Pattern**: `{type}:{id}`

**Type Values**:

- `page` - for LibGuides page audits
- `guide` - for LibGuides guide audits

**Example Keys**:

- `page:8997487`
- `page:8997489`
- `guide:26856`
- `guide:10729`

**Value Structure**:

```json
{
  "links": true,
  "accessibility": false,
  "accuracy": true,
  "updatedAt": "2026-01-15T10:30:00.000Z"
}
```

**Field Definitions**:

- `links` (boolean): Whether links audit check passed
- `accessibility` (boolean): Whether accessibility audit check passed
- `accuracy` (boolean): Whether accuracy audit check passed
- `updatedAt` (string): ISO 8601 timestamp - **Added by Worker on save**

### Worker K/V Endpoints

| **HTTP Method** | **Endpoint** | **Request Body** | **Response** | **Code Location** |
|-----------------|--------------|------------------|--------------|-------------------|
| GET | `/stewardship` | - | `{pageId: {expert, editor, department}, ...}` | worker.js:59-72 |
| PUT | `/stewardship` | `{pageId, expert, editor, department}` | `{ok: true}` | worker.js:75-84 |
| GET | `/audit` | - | `[{key, value}, ...]` | worker.js:104-115 |
| PUT | `/audit` | `{type, id, checks: {links, accessibility, accuracy}}` | `{ok: true}` | worker.js:89-101 |
| DELETE | `/audit` | `{prefix}` | `{ok: true}` | worker.js:118-131 |

### Worker Code Analysis

**Stewardship Helper Functions** (worker.js):

```javascript
// GET /stewardship → { pageId: { expert, editor }, ... }
async function getStewardship(env) {
  const { keys } = await env.AUDIT.list({ prefix: 'steward:' });
  const entries = await Promise.all(
    keys.map(async ({ name }) => {
      const val = await env.AUDIT.get(name);
      return { pageId: name.slice('steward:'.length), value: val ? JSON.parse(val) : null };
    })
  );
  const result = {};
  for (const { pageId, value } of entries) {
    if (value) result[pageId] = value;
  }
  return jsonResponse(result);
}

// PUT /stewardship  { pageId, expert, editor, department }
async function saveStewardshipEntry(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const { pageId, expert, editor, department } = body;
  if (!pageId) return jsonResponse({ error: 'pageId required' }, 400);
  await env.AUDIT.put(`steward:${pageId}`, 
    JSON.stringify({ expert: expert || '', editor: editor || '', department: department || '' })
  );
  return jsonResponse({ ok: true });
}
```

**Audit Helper Functions** (worker.js):

```javascript
// PUT /audit  { type: 'page'|'guide', id, checks: { links, accessibility, accuracy } }
async function saveAudit(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const { type, id, checks } = body;
  if (!type || !id) return jsonResponse({ error: 'type and id required' }, 400);

  const key = `${type}:${id}`;
  const value = JSON.stringify({ ...checks, updatedAt: new Date().toISOString() });
  await env.AUDIT.put(key, value);
  return jsonResponse({ ok: true });
}

// GET /audit?prefix=page:  — returns all entries matching prefix
async function listAudit(request, env) {
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') ?? '';
  const { keys } = await env.AUDIT.list({ prefix });
  const entries = await Promise.all(
    keys.map(async ({ name }) => {
      const val = await env.AUDIT.get(name);
      return { key: name, value: val ? JSON.parse(val) : null };
    })
  );
  return jsonResponse(entries);
}

// DELETE /audit  { prefix }  — removes all keys with that prefix (audit reset)
async function resetAudit(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const prefix = body.prefix ?? '';
  let cursor;
  do {
    const result = await env.AUDIT.list({ prefix, cursor });
    await Promise.all(result.keys.map(({ name }) => env.AUDIT.delete(name)));
    cursor = result.list_complete ? null : result.cursor;
  } while (cursor);
  return jsonResponse({ ok: true });
}
```

---

## 🌐 CLOUDFLARE WORKER: LIBGUIDES API INTERACTIONS

### LibGuides API Configuration

**Base URLs** (worker.js):

```javascript
const LIBGUIDES_BASE = 'https://lgapi-us.libapps.com';
const TOKEN_URL = `${LIBGUIDES_BASE}/1.2/oauth/token`;
const API_BASE  = `${LIBGUIDES_BASE}/1.2`;
```

### OAuth Token Management

**Token Caching** (per-isolate):

```javascript
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.LIBGUIDES_CLIENT_ID,
      client_secret: env.LIBGUIDES_CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}
```

**Token Expiry**: `Date.now() + (data.expires_in - 60) * 1000` (60 seconds buffer)

### LibGuides API Proxy Endpoints

| **HTTP Method**   | **Worker Endpoint** | **LibGuides API** | **Query Params** | **Response Processing**  | **Code Location** |
|-------------------|---------------------|-------------------|------------------|--------------------------|-------------------|
| GET               | `/accounts`         | `/1.2/accounts`   | -                | PII stripped             | worker.js:126-132 |
| GET               | `/guides`           | `/1.2/guides`     | `status=1&expand=pages,pages.boxes,owner` | Full pass-through | worker.js:139-149 |
| GET               | `/guides`           | `/1.2/guides`     | `status=0&expand=pages,owner` | Full pass-through | worker.js:139-149 |

**Proxy Logic** (worker.js):

```javascript
// GET /* → proxy to LibGuides API
if (request.method !== 'GET') {
  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
}

try {
  const token = await getAccessToken(env);
  const apiPath = pathname === '/' ? '/guides' : pathname;
  const apiUrl = `${API_BASE}${apiPath}${search}`;

  const apiRes = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  // Strip PII from accounts before returning to client
  if (pathname === '/accounts' && apiRes.ok) {
    const accounts = await apiRes.json();
    const safe = accounts.map(({ id, first_name, last_name }) => ({ id, first_name, last_name }));
    return jsonResponse(safe);
  }

  const body = await apiRes.arrayBuffer();
  return new Response(body, {
    status: apiRes.status,
    headers: {
      'Content-Type': apiRes.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(),
    },
  });
} catch (err) {
  return jsonResponse({ error: 'Worker error', message: err.message }, 500);
}
```

### LibGuides Data Structures

#### Accounts Data

**Raw Response** (before PII stripping):

```json
[
  {
    "id": 12345,
    "first_name": "John",
    "last_name": "Doe",
    "email": "jdoe@caltech.edu",
    "owner_type": "user",
    "username": "jdoe",
    "account_status": "active",
    "site_id": 123,
    // ... other fields
  }
]
```

**Processed Response** (PII stripped by Worker):

```json
[
  {
    "id": 12345,
    "first_name": "John",
    "last_name": "Doe"
  }
]
```

**Frontend Processing** (app.js lines 349-365):

```javascript
state.names = accounts
  .filter(a => {
    if (!a.first_name && !a.last_name) return false;
    const email = (a.email || '').toLowerCase();
    if (email.endsWith('@springshare.com')) return false;
    if ((a.last_name || '').includes('(test)')) return false;
    if (email.includes('+')) return false;  // service/alias accounts
    return true;
  })
  .map(a => `${a.first_name} ${a.last_name}`.trim())
  .filter(Boolean)
  .sort((a,b) => a.localeCompare(b));
```

> **⚠️ Dead code note**: The email-based filters (`@springshare.com` and `+`) are silently no-ops in the current app. The worker strips `email` before returning the accounts response, so `a.email` is always `undefined` in the browser. Only the `(test)` filter on `last_name` remains functional. The migration should fix this — the backend proxy's PII-stripped response already excludes email, so these filters should either be removed or the proxy should retain a safe form of the email for filtering purposes (e.g. only the domain suffix).

#### Guides Data

**Request Pattern**:

```
GET /1.2/guides?status=1&expand=pages,pages.boxes,owner
```

**Query Parameters**:

- `status=1` - Published guides only
- `status=0` - Unpublished/draft guides
- `expand=pages` - Include page data
- `expand=pages.boxes` - Include box content for each page
- `expand=owner` - Include owner information

**Guide Object Structure**:

```json
{
  "id": 26856,
  "name": "Guide Title",
  "title": "Guide Title (may differ from name)",
  "friendly_url": "https://caltech.libapps.com/libguides/admin_c.php?g=26856",
  "url": "https://caltech.libapps.com/libguides/admin_c.php?g=26856",
  "group_id": 26856,
  "description": "Guide description",
  "updated": "2026-01-15 10:30:00",
  "status": 1,
  "owner": {
    "id": 12345,
    "first_name": "John",
    "last_name": "Doe",
    "email": "jdoe@caltech.edu",
    "account_status": "active"
  },
  "pages": [
    {
      "id": 8997487,
      "name": "Page Title",
      "label": "Page Label",
      "friendly_url": "https://caltech.libapps.com/libguides/admin_c.php?g=26856&p=8997487",
      "url": "https://caltech.libapps.com/libguides/admin_c.php?g=26856&p=8997487",
      "redirect_url": "",
      "updated": "2026-01-15 10:30:00",
      "enable_display": 1,
      "position": 0,
      "type": "standard",
      "boxes": [
        {
          "id": 123456,
          "type": "rich_text",
          "name": "Page Steward",
          "label": "Page Steward",
          "content": "<div class=\"alert alert-info\">Page Steward: <strong>Tony Diaz</strong><br/>Page Deputy: <strong>Penny Neder-Muro</strong><br/>Last Updated by: <strong>Ian Roberts</strong></div>",
          "position": 0
        }
      ]
    }
  ]
}
```

---

## 📋 FRONTEND DATA FLOW ANALYSIS

### Data Loading Sequence

The `loadData()` function (app.js lines 318-415) orchestrates all data loading:

```
1. Load Stewardship Data
   ├─ GET /stewardship (via Worker → KV)
   ├─ If KV empty → Seed from stewardship.json
   │  └─ For each entry: PUT /stewardship (via Worker → KV)
   └─ Store in state.stewardship

2. Load Accounts Data
   ├─ GET /accounts (via Worker → LibGuides API → PII stripped)
   └─ Store in state.names (after filtering)

3. Load Audit State
   ├─ First: localStorage cache (instant)
   └─ Second: GET /audit (via Worker → KV) merged on top

4. Load Guides Data
   ├─ Check sessionStorage cache first
   ├─ If not in cache or force=true → GET /guides?status=1&expand=pages,pages.boxes,owner
   ├─ Process through processGuides() function
   └─ Store in state.pages, state.guideOptions
```

### Data Processing: processGuides()

**Function**: `processGuides(guides)` (app.js lines 260-314)

**Input**: Array of guide objects from LibGuides API

**Output**: 

- `state.pages` - Array of processed PageRecord objects
- `state.names` - Array of staff names (if not already loaded)
- `state.guideOptions` - Array of unique guide titles

**Processing Logic**:

```javascript
for (const guide of guides) {
  if (!Array.isArray(guide.pages)) continue;
  
  const guideTitle = decodeEntities(guide.title || guide.name || '(untitled guide)');
  const ownerName = guide.owner
    ? `${guide.owner.first_name ?? ''} ${guide.owner.last_name ?? ''}`.trim()
    : null;

  for (const page of guide.pages) {
    // Try KV first
    const jsonEntry = state.stewardship[String(page.id)];
    let rawExpert, rawEditor, lastUpdatedBy, hasStewardshipBox;

    if (jsonEntry) {
      // From KV
      rawExpert = jsonEntry.expert || null;
      rawEditor = jsonEntry.editor || null;
      hasStewardshipBox = true;
    } else {
      // Fallback: Parse from HTML
      const sh = findStewardship(page.boxes);
      rawExpert = sh?.expert ?? null;
      rawEditor = sh?.editor ?? null;
      lastUpdatedBy = sh?.lastUpdatedBy ?? null;
      hasStewardshipBox = sh !== null;
    }

    const expert = isUnassigned(rawExpert) ? null : rawExpert;
    const editor = isUnassigned(rawEditor) ? null : rawEditor;
    const department = jsonEntry?.department || null;

    // Add to names list
    if (expert) nameSet.add(expert);
    if (editor) nameSet.add(editor);
    if (ownerName) nameSet.add(ownerName);
    guideSet.add(guideTitle);

    pages.push({
      guideId: guide.id,
      guideTitle,
      guideOwner: ownerName,
      guideFriendlyUrl: guide.friendly_url || guide.url || null,
      groupId: guide.group_id != null ? Number(guide.group_id) : null,
      pageId: page.id,
      pageLabel: page.label || page.name || '(untitled)',
      pageFriendlyUrl: page.friendly_url || page.url || null,
      pageRedirectUrl: page.redirect_url || null,
      updated: page.updated || null,
      guideUpdated: guide.updated || null,
      enableDisplay: page.enable_display ?? 1,
      expert,
      editor,
      department,
      lastUpdatedBy,
      hasStewardshipBox,
      freshness: freshnessStatus(page.updated),
    });
  }
}
```

### Stewardship Box Parsing

**Function**: `parseStewardshipBox(html)` (app.js lines 218-230)

**Input**: HTML content from a box

**Output**: Parsed stewardship information or null

**Parsing Logic**:

```javascript
function parseStewardshipBox(html) {
  if (!html || !html.includes('Page Steward:')) return null;
  
  const div = document.createElement('div');
  div.innerHTML = html;
  
  const alert = div.querySelector('.alert.alert-info');
  if (!alert) return null;
  
  const inner = alert.innerHTML;
  const expertM = inner.match(/Page Steward:<\/strong>\s*([^<\n]*)/i);
  const editorM = inner.match(/Page Deputy:<\/strong>\s*([^<\n]*)/i);
  const updatedByM = inner.match(/Last Updated by:<\/strong>\s*([^<\n]*)/i);
  
  return {
    expert: expertM ? expertM[1].trim() : null,
    editor: editorM ? editorM[1].trim() : null,
    lastUpdatedBy: updatedByM ? updatedByM[1].trim() : null,
  };
}
```

### Data Saving Patterns

#### Stewardship Save

**Frontend Call** (app.js line 1486 - inline edit):

```javascript
fetch(`${CONFIG.WORKER_URL}/stewardship`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    pageId, 
    expert: entry.expert || '', 
    editor: entry.editor || '', 
    department: entry.department || '' 
  })
});
```

**Worker Processing** (worker.js lines 52-58):

```javascript
const { pageId, expert, editor, department } = body;
if (!pageId) return jsonResponse({ error: 'pageId required' }, 400);
await env.AUDIT.put(`steward:${pageId}`, 
  JSON.stringify({ expert: expert || '', editor: editor || '', department: department || '' })
);
return jsonResponse({ ok: true });
```

#### Audit Save (Multiple Patterns)

**Pattern 1** - Single checkbox (app.js line 193):

```javascript
fetch(`${CONFIG.WORKER_URL}/audit`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type, id, checks: current })
});
```

**Pattern 2** - Clear field (app.js line 208):

```javascript
fetch(`${CONFIG.WORKER_URL}/audit`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type, id, checks: state.audit[key] })
});
```

**Pattern 3** - Sync all audit (app.js line 146):

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

**Worker Processing** (worker.js lines 60-68):

```javascript
const { type, id, checks } = body;
if (!type || !id) return jsonResponse({ error: 'type and id required' }, 400);

const key = `${type}:${id}`;
const value = JSON.stringify({ ...checks, updatedAt: new Date().toISOString() });
await env.AUDIT.put(key, value);
return jsonResponse({ ok: true });
```

---

## 🎯 SPECIFIC OBJECTS & SCHEMAS REQUIRED

### 1. Stewardship Object

**Current Source**: Cloudflare KV (`steward:{pageId}`)

**Current Schema**:

```json
{
  "expert": "string | ''",
  "editor": "string | ''",
  "department": "string | '' | undefined"
}
```

**Target Schema for Dataset** (enhanced):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "Stewardship Entry",
  "description": "Content stewardship assignment for a LibGuides page",
  "properties": {
    "pageId": {
      "type": "string",
      "pattern": "^[0-9]+$",
      "description": "LibGuides page ID (unique identifier)",
      "minLength": 1
    },
    "expert": {
      "type": ["string", "null"],
      "description": "Content expert name",
      "maxLength": 100
    },
    "editor": {
      "type": ["string", "null"],
      "description": "Content editor name",
      "maxLength": 100
    },
    "department": {
      "type": ["string", "null"],
      "description": "Department code",
      "enum": ["Archives", "ACS", "CLOPS", "DLD", "LIT", "RS", null],
      "maxLength": 20
    },
    "lastUpdated": {
      "type": "string",
      "format": "date-time",
      "description": "When record was last updated",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$"
    },
    "updatedBy": {
      "type": ["string", "null"],
      "description": "Who last updated this record",
      "maxLength": 50
    }
  },
  "required": ["pageId", "lastUpdated"],
  "additionalProperties": false
}
```

**Key Strategy for Dataset**:

- **Collection**: `stewardship.ds`
- **Object Key**: `{pageId}` (simplified from `steward:{pageId}`)
- **Validation**: Schema validation enabled in datasetd

**Migration Transformation**:

```javascript
// From Cloudflare KV: steward:{pageId} → {expert, editor, department}
// To Dataset: {pageId} → {pageId, expert, editor, department, lastUpdated, updatedBy}

// Example:
// KV Key: steward:8997487
// KV Value: { expert: "Tony Diaz", editor: "", department: "Archives" }

// Dataset Key: 8997487
// Dataset Value: {
//   pageId: "8997487",
//   expert: "Tony Diaz",
//   editor: null,        // Empty string → null
//   department: "Archives",
//   lastUpdated: "2026-05-28T12:00:00Z",
//   updatedBy: "migration-script"
// }
```

### 2. Audit Object

**Current Source**: Cloudflare KV (`{type}:{id}`)

**Current Schema**:

```json
{
  "links": boolean,
  "accessibility": boolean,
  "accuracy": boolean,
  "updatedAt": "ISO 8601 timestamp"
}
```

**Target Schema for Dataset** (enhanced):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "Audit Entry",
  "description": "Audit check results for a LibGuides page or guide",
  "properties": {
    "type": {
      "type": "string",
      "enum": ["page", "guide"],
      "description": "Type of content being audited"
    },
    "id": {
      "type": "string",
      "pattern": "^[0-9]+$",
      "description": "ID of the page or guide",
      "minLength": 1
    },
    "links": {
      "type": "boolean",
      "description": "Links audit check passed"
    },
    "accessibility": {
      "type": "boolean",
      "description": "Accessibility audit check passed"
    },
    "accuracy": {
      "type": "boolean",
      "description": "Accuracy audit check passed"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "When audit was last updated",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$"
    },
    "updatedBy": {
      "type": ["string", "null"],
      "description": "Who performed the audit",
      "maxLength": 50
    }
  },
  "required": ["type", "id", "links", "accessibility", "accuracy", "updatedAt"],
  "additionalProperties": false
}
```

**Key Strategy for Dataset**:

- **Collection**: `audit.ds`
- **Object Key**: `{type}:{id}` (same as current Cloudflare pattern)
- **Validation**: Schema validation enabled in datasetd

**Migration Transformation**:

A simple Bash script using `jq` can handle the translation of `stewardship.json` to the JSONL needed to load into dataset.

### 3. Page Object (Processed)

**Source**: LibGuides API via Worker (processed by frontend)

**Structure** (from processGuides function):

```javascript
{
  // From LibGuides
  guideId: number,              // Guide ID
  guideTitle: string,          // Decoded guide title
  guideOwner: string | null,   // "First Last" from owner
  guideFriendlyUrl: string | null,
  groupId: number | null,      // Guide group ID
  pageId: number,              // Page ID
  pageLabel: string,           // Page title
  pageFriendlyUrl: string | null,
  pageRedirectUrl: string | null,
  updated: string | null,      // Page updated timestamp (YYYY-MM-DD HH:MM:SS)
  guideUpdated: string | null,  // Guide updated timestamp
  enableDisplay: number,        // 1 = visible, other = hidden
  
  // From Stewardship (KV or HTML parsing)
  expert: string | null,       // Normalized (empty → null)
  editor: string | null,       // Normalized (empty → null)
  department: string | null,   // From KV only
  lastUpdatedBy: string | null,// From HTML parsing only
  hasStewardshipBox: boolean,   // Whether page has stewardship box
  
  // Computed
  freshness: string            // 'current' | 'stale' | 'very-stale'
}
```

**Freshness Calculation** (app.js):

```javascript
function freshnessStatus(updatedStr) {
  const d = daysAgo(updatedStr);
  if (d > CONFIG.VERY_STALE_DAYS) return 'very-stale';
  if (d > CONFIG.STALE_DAYS)      return 'stale';
  return 'current';
}

// From config.js
STALE_DAYS: 365
VERY_STALE_DAYS: 730
```

### 4. Guide Object (Derived)

**Used in**: Research Guides view

**Structure**:

```javascript
{
  guideId: number,
  guideTitle: string,
  guideOwner: string | null,
  guideFriendlyUrl: string | null,
  guideUpdated: string | null,
  pages: [PageObject, ...],
  pageCount: number,          // Count of visible pages (enableDisplay === 1)
  freshness: string           // Based on oldest page update
}
```

### 5. Account Object (Processed)

**Source**: LibGuides API via Worker (PII stripped)

**Processed Structure**:

```javascript
{
  id: number,
  first_name: string,
  last_name: string
}
```

**Frontend Transformation**:

```javascript
// Filter and format for display
state.names = accounts
  .filter(a => !(!a.first_name && !a.last_name))                             // Has name
  .filter(a => !a.email?.toLowerCase().endsWith('@springshare.com'))      // Not Springshare
  .filter(a => !(a.last_name || '').includes('(test)'))                     // Not test
  .filter(a => !(a.email || '').includes('+'))                              // Not service
  .map(a => `${a.first_name} ${a.last_name}`.trim())                        // Full name
  .filter(Boolean)                                                            // Remove empty
  .sort((a,b) => a.localeCompare(b));                                        // Alphabetical
```

---

## 🔍 INTERACTION PATTERNS SUMMARY

### Cloudflare KV Interactions (Complete List)

| **Call Location** | **HTTP Method** | **Endpoint** | **Frequency** | **Purpose** | **Code Line** |
|-------------------|----------------|--------------|---------------|-------------|---------------|
| loadData() | GET | `/stewardship` | Once on load | Load all stewardship data | app.js:323 |
| loadData() | PUT | `/stewardship` | Per seed (45x) | Seed KV from stewardship.json | app.js:336 |
| loadData() | GET | `/audit` | Once on load | Load all audit data | app.js:374 |
| syncAudit() | GET | `/audit` | On save button click | Refresh audit from KV | app.js:146 |
| saveAuditCheck() | PUT | `/audit` | Per checkbox change | Save single audit check | app.js:193 |
| clearAuditField() | PUT | `/audit` | Per clear field | Save cleared audit field | app.js:208 |
| Inline edit | PUT | `/stewardship` | Per change | Save stewardship changes | app.js:1486 |

**Total**: 11 distinct KV interaction points in frontend code

### LibGuides API Interactions (via Worker)

| **Call Location** | **HTTP Method** | **Endpoint** | **Query Params** | **Frequency** | **Purpose** | **Code Line** |
|-------------------|----------------|--------------|------------------|---------------|-------------|---------------|
| loadData() | GET | `/accounts` | - | Once on load | Load staff names | app.js:349 |
| loadData() | GET | `/guides` | `status=1&expand=pages,pages.boxes,owner` | Once on load (cached) | Load published guides | app.js:402 |
| runUnpublishedReport() | GET | `/guides` | `status=0&expand=pages,owner` | On demand | Load unpublished website pages | app.js:1203 |
| runRgUnpublishedReport() | GET | `/guides` | `status=0&expand=pages,owner` | On demand | Load unpublished research guides | app.js:1286 |

**Total**: 4 distinct LibGuides API interaction points in frontend code

### Caching Strategy

| **Data Type** | **Storage** | **Key** | **TTL** | **Fallback** |
|---------------|-------------|---------|---------|--------------|
| Guides data | sessionStorage | `cs_guides_v1` | Session | Network fetch |
| Audit data | localStorage | `audit_cache` | Persistent | Network fetch |
| Last view | localStorage | `last_view` | Persistent | Default view |
| Report filters | state | In-memory | Session | Reset on load |

---

## 🎯 DATASET SCHEMAS SUMMARY

### Required Collections

| **Collection** | **Purpose** | **Key Pattern** | **Schema** | **Validation** |
|----------------|-------------|----------------|-----------|----------------|
| stewardship.ds | Page-level stewardship | `{pageId}` | stewardship | ✅ Enabled |
| audit.ds | Audit check results | `{type}:{id}` | audit | ✅ Enabled |


### Schema 1: Stewardship

**Collection**: `stewardship.ds`  
**Key**: `{pageId}` (numeric string)  
**Validation**: Schema-based with `validate: true`

**Fields**:

- `pageId` (required): String, numeric, unique identifier
- `expert` (nullable): String, max 100 chars, content expert name
- `editor` (nullable): String, max 100 chars, content editor name
- `department` (nullable): String, enum [Archives, ACS, CLOPS, DLD, LIT, RS, null]
- `lastUpdated` (required): ISO 8601 timestamp, when record was updated
- `updatedBy` (nullable): String, max 50 chars, who updated the record

### Schema 2: Audit

**Collection**: `audit.ds`  
**Key**: `{type}:{id}` (e.g., `page:8997487`, `guide:26856`)  
**Validation**: Schema-based with `validate: true`

**Fields**:

- `type` (required): String, enum [page, guide], content type
- `id` (required): String, numeric, identifier of page/guide
- `links` (required): Boolean, links audit passed
- `accessibility` (required): Boolean, accessibility audit passed
- `accuracy` (required): Boolean, accuracy audit passed
- `updatedAt` (required): ISO 8601 timestamp, when audit was updated
- `updatedBy` (nullable): String, max 50 chars, who performed the audit

---

## 🔐 AUTHENTICATION CONTEXT

### Current Authentication (Cloudflare)

**Cloudflare Worker**:

- OAuth for LibGuides API (server-side in Worker)
- Cloudflare KV (internal to Worker, no auth needed)
- CORS headers for browser access
- No user authentication for the dashboard itself

**Browser**:

- Accesses Worker endpoints directly
- Worker adds CORS headers: `Access-Control-Allow-Origin: *`
- No authentication required for dashboard access

**Current Deployment**: https://caltechlibrary.github.io/content-dashboard/

- GitHub Pages hosting (static files)
- Worker deployed to: https://restless-sea-ca3c.twila.workers.dev
- **Open access** - anyone can view the dashboard

### Target Authentication (Production)

**Shibboleth Integration**:

- **Production URL**: https://apps.library.caltech.edu/content-dashboard/
- **Web Server**: Apache or Nginx with Shibboleth Service Provider
- **Authentication**: Shibboleth handles AuthN/AuthZ at web server level
- **Scope**: Entire application (static files + API endpoints)

**Key Points**:

1. **No authentication code needed in datasetd** - Shibboleth SP handles it
2. **No authentication code needed in our application** - Shibboleth SP handles it
3. **datasetd runs behind Shibboleth-protected web server**
4. **Browser makes authenticated requests** to datasetd via Shibboleth

### LibGuides API Authentication Question

**Current Understanding**:

- LibGuides **user interface** can use campus single sign-on (Shibboleth) ✅
- LibGuides **API** authentication is **TBD** ⚠️

**Two Scenarios**:

#### Scenario A: LibGuides API Supports Shibboleth ✅

If LibGuides API accepts Shibboleth authentication:

```
Browser → Shibboleth SP → LibGuides API
     (datasetd)      (Shibboleth)
```

- **Impact**: Backend proxy service **not needed** for authentication
- **Benefit**: Simplest architecture
- **Action**: Confirm with Springshare/LibGuides support

#### Scenario B: LibGuides API Requires OAuth Only ⚠️

If LibGuides API only supports OAuth (current situation):

```
Browser → datasetd → Backend Proxy → LibGuides API
                 (Shibboleth)    (OAuth)
```

- **Impact**: Backend proxy service **required** for OAuth
- **Reason**: OAuth client credentials must not be exposed in browser
- **Action**: Implement backend proxy service (Deno+TypeScript)

**Backend Proxy Responsibilities**:

1. Accept requests from authenticated users (Shibboleth-protected)
2. Manage OAuth token for LibGuides API
3. Proxy LibGuides API requests
4. Strip PII from responses
5. Cache responses to reduce API calls

**Recommendation**:

- **Confirm with Springshare** whether LibGuides API supports Shibboleth
- **Assume OAuth-only** for now and plan for backend proxy
- **If Shibboleth works**, simplify architecture by removing proxy

### Middleware Decision

**Question**: Do we need middleware for data validation before CRUD operations?

**Answer**: **NO**

**Rationale**:

1. **datasetd v2.4.1+ has the models package** (`github.com/caltechlibrary/models`) - provides YAML-based data model definitions with HTML5 form element types, validation patterns, required fields, and primary ID indicators
2. **Server-side validation** - Validation happens in Go via the models package before data is stored
3. **datasetd has collection-level permissions** - read, create, update, delete
4. **datasetd has SQL query support** - for complex reporting
5. **No transformation needed** - data structures are straightforward
6. **Shibboleth handles authentication** - at web server level

**This is a NEW FEATURE** in datasetd that provides robust validation capabilities without requiring custom middleware.

**Testing Required**: Since this is a newer feature, we should test that:

- Model validation properly rejects invalid data
- Pattern matching works as expected (e.g., numeric page IDs)
- Required fields are enforced
- Primary ID fields are handled correctly

**Conclusion**: **No custom middleware required** for dataset CRUD operations.

---

## 📊 DATA VOLUME & PERFORMANCE

### Current Data Volume

**From stewardship.json**:

- **Stewardship entries**: 45 entries
- **Page IDs**: Numeric, ranging from 8,997,487 to 11,310,049
- **File size**: ~3KB uncompressed

**Estimated Full Dataset**:

- **Stewardship**: 45-100 entries (all website pages)
- **Audit**: 45-100 entries per type (page + guide) = 90-200 total
- **Accounts**: ~50-200 staff members (from LibGuides)
- **Guides**: ~50-200 guides (based on group IDs in config)

**Total Estimated Data Size**: < 1MB (well within datasetd limits)

### Performance Considerations

**Current Performance**:

- Cloudflare KV: Fast, edge-cached, global distribution
- LibGuides API: Network latency + OAuth token management
- Frontend: Local caching (sessionStorage/localStorage)

**Target Performance**:

- datasetd (SQLite): Local disk I/O, very fast for small datasets
- datasetd (Postgres): Network + SQL, still fast for small datasets
- Backend Proxy: Adds one network hop for LibGuides data
- Frontend: Same caching strategy

**Performance Impact**:

- ✅ **Dataset operations**: Will be **faster** than Cloudflare KV (local vs edge)
- ⚠️ **LibGuides operations**: Will be **slightly slower** (adds proxy hop)
- ✅ **Overall**: Performance should be **comparable or better**

### Caching Strategy (To Maintain)

**Current**:

- Guides data: sessionStorage (session-persistent)
- Audit data: localStorage (persistent across sessions)
- Last view: localStorage (persistent)

**Target**:

- Keep same caching strategy
- Add datasetd-level caching if needed
- Backend proxy can cache LibGuides responses

---

## 📝 SUMMARY & KEY FINDINGS

### 1. Cloudflare K/V Interactions

**Where**: Worker endpoints `/stewardship` and `/audit`  
**What**: CRUD operations on stewardship and audit data  
**How**: 11 interaction points in frontend code  
**Data**: Simple key-value with JSON values

### 2. LibGuides API Interactions

**Where**: Worker endpoints `/accounts` and `/guides`  
**What**: Proxy to LibGuides API with OAuth and PII stripping  
**How**: 4 interaction points in frontend code  
**Data**: Complex nested objects (guides, pages, boxes, owners)

### 3. Specific Objects & Schemas

| **Object** | **Source** | **Current Schema** | **Target Schema** | **Collection** |
|------------|------------|--------------------|------------------|----------------|
| Stewardship | Cloudflare KV | `{expert, editor, department}` | `{pageId, expert, editor, department, lastUpdated, updatedBy}` | stewardship.ds |
| Audit | Cloudflare KV | `{links, accessibility, accuracy, updatedAt}` | `{type, id, links, accessibility, accuracy, updatedAt, updatedBy}` | audit.ds |
| Accounts | LibGuides API | `{id, first_name, last_name, ...}` | `{id, first_name, last_name}` (PII stripped) | N/A (via proxy) |
| Guides | LibGuides API | Complex nested structure | Same (via proxy) | N/A (via proxy) |

### 4. Repository Restructuring

**Current**: Flat structure with mixed concerns  
**Target**: 

- `htdocs/` - Browser-served static files
- `content-dashboard.yaml` - datasetd configuration
- `dev-notes/` - Development Notes
- `./` - Software Documentation

### 5. Authentication

**Current**: No authentication, open access via GitHub Pages  
**Target**: Shibboleth-protected in production  
**LibGuides API**: OAuth (current), Shibboleth support TBD

### 6. Middleware Decision

**Question**: Do we need Deno+TypeScript middleware for validation?  
**Answer**: **NO** - datasetd has sufficient built-in features  
**Question**: Do we need middleware to proxy to LibGuide's API
**Answer**: **NO** - the browser takes advantage of single sign-on, and talks to LibGuides API integration, we save updates in our dataset collection via it's JSON API
