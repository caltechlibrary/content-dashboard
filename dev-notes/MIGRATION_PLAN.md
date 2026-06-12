# Content Dashboard: Migration Plan

## Cloudflare K/V → Dataset Backend Migration

**Project**: Content Dashboard (content-dashboard)  
**Repository**: caltechlibrary/content-dashboard  
**Current Deployment**: https://caltechlibrary.github.io/content-dashboard/  
**Target**: Dataset-backed web application with repository restructuring  
**Date**: 2026-05-28  
**Status**: Analysis & Planning Phase

---

## 🎯 EXECUTIVE SUMMARY

This document outlines the comprehensive migration of **content-dashboard** from Cloudflare Workers + KV store to a **dataset-backed web application**. The migration includes:

1. **Repository restructuring** - Separate browser code from server configuration
2. **Backend replacement** - Cloudflare KV → datasetd with SQLite/Postgres storage
3. **Authentication integration** - Leverage existing Shibboleth infrastructure
4. **Middleware assessment** - Evaluate need for Deno+TypeScript validation layer
5. **LibGuides API integration** - Determine OAuth vs Shibboleth compatibility

**Key Decision**: Datasetd provides sufficient validation and query capabilities. **No custom middleware required** for CRUD operations.

**Note on Models Package**: Datasetd v2.4.1+ integrates with the `github.com/caltechlibrary/models` Go package, which provides **YAML-based data model definitions** for validation. These models can define form elements, validation patterns, primary IDs, and more. This is a newer feature that provides robust validation without requiring custom middleware.

---

## 📁 REPOSITORY RESTRUCTURING PLAN

### Current Repository Structure

```
content-dashboard/
├── app.js              # Frontend application logic
├── config.js           # Configuration constants
├── index.html          # Main HTML entry point
├── stewardship.json    # Seed data for stewardship
├── styles.css          # Application styling
├── worker.js           # Cloudflare Worker (backend)
├── wrangler.toml       # Cloudflare Worker configuration
└── .wrangler/          # Cloudflare deployment state
```

### Proposed Repository Structure

```
content-dashboard/
├── README.md                          # Project overview, setup, usage
├── LICENSE                            # License file
├── codemeta.json                      # Project metadata
├── content_dashboard.yaml             # datasetd configuration (server-side)
│
├── htdocs/                            # Browser-served content (root for web server)
│   ├── index.html                     # Main HTML entry point
│   ├── app.js                         # Frontend application logic
│   ├── config.js                      # Configuration (updated for datasetd)
│   └── styles.css                     # Application styling
│
├── stewardship.ds                     # Stewardship data collection
├── audit.ds                           # Audit data collection
└── dev-notes/                              # Additional documentation
    ├── API.md                         # API endpoint documentation
    ├── DATA_SCHEMAS.md                # Dataset collection schemas
    └── DEPLOYMENT.md                  # Production deployment guide
```

### Rationale for Restructuring

1. **Separation of Concerns**: Browser code (static) vs server configuration (dynamic)
2. **Standard Web Server Convention**: `htdocs/` is the standard document root
3. **Clear Operator Path**: Configuration files in root for easy access
4. **Scalability**: Structure supports multiple collections and future expansion
5. **Compatibility**: Works with standard web servers (Apache, Nginx, etc.)

### Migration Steps for Repository

1. **Create new directory structure**
   ```bash
   mkdir -p htdocs assets scripts collections docs
   ```
2. **Move browser files**
   ```bash
   mv index.html app.js config.js styles.css stewardship.json htdocs/
   ```
3. **Add server configuration**
   - Create `content_dashboard.yaml` or `settings.yaml`
4. **Update references**
   - Update `index.html` script/src paths (already relative, should work)
   - Update any internal links
   - Update browser JavaScript to use dataset's JSON API
5. **Clean up old files**
   ```bash
   rm worker.js wrangler.toml
   rm -rf .wrangler/
   ```
6. **Document Project implementation**
   - Use CMTools to generate the software documentation structure
   - Create operator/admin documentation, link into the user_manual.md
   - Deploy to the gh-pages branch and push to GitHub (use Makefile after creating gh-pages branch)
---

## 🏗️ ARCHITECTURE OVERVIEW

### Current Architecture (Cloudflare)

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Browser           │────▶│ Cloudflare Worker    │────▶│ LibGuides API   │
│   (GitHub Pages)    │     │ - worker.js          │     │ (OAuth)         │
└─────────────────────┘     │ - OAuth proxy        │     └─────────────────┘
         ▲                  │ - KV storage         │
         │                  └─────────┬────────────┘
         │                            │
         │                  ┌─────────▼─────────┐
         │                  │ Cloudflare KV     │
         │                  │ Namespace: AUDIT  │
         └──────────────────────────────────────┘
```

**Current Deployment**: https://caltechlibrary.github.io/content-dashboard/ (GitHub Pages, no auth)

### Target Architecture (Dataset + Shibboleth)

```
                         apps.library.caltech.edu/content-dashboard/

┌─────────────────────┐     ┌──────────────────────┐     ┌────────────────────┐
│   Browser           │────▶│ Shibboleth SP        │────▶│ datasetd :8200     │
│   (static files     │     │ (Apache)             │     │ - collections      │
│    from htdocs/)    │     │ - AuthN/AuthZ        │     │ - SQLite storage   │
└─────────────────────┘     │ - REMOTE_USER header │     └────────────────────┘
                            └────────┬─────────────┘
                                     │                   ┌────────────────────┐
                                     ├──────────────────▶│ Deno Proxy :8080   │
                                     │                   │ - /api/whoami      │
                         ┌───────────┴───────────┐       │ - /api/libguides/  │
                         │       Campus SSO      │       └─────────┬──────────┘
                         │      (Shibboleth IdP) │                 │
                         └───────────────────────┘    ┌────────────▼───────────┐
                                                       │  LibGuides API (OAuth) │
                                                       │  lgapi-us.libapps.com  │
                                                       └────────────────────────┘
```

### Authentication Flow

**Production Environment**:

```
1. User accesses https://apps.library.caltech.edu/content-dashboard/
2. Shibboleth Service Provider (Apache) intercepts request
3. Redirects to Caltech Shibboleth IdP for authentication
4. On successful auth, user is redirected back with Shibboleth session attributes
5. datasetd serves static files from htdocs/ directory
6. Browser makes API calls to datasetd (protected by Shibboleth)
7. For LibGuides data: Browser should use the worker.js to LibGuides's API
8. `updatedBy` identity comes from Shibboleth session headers forwarded by Apache, may need to write a minimal middleware to pick the value up server side if browser submission not secure enough
```

**Key Point**: Shibboleth handles authentication for the web application. LibGuides API access is a separate concern.

---

## 🔐 AUTHENTICATION & AUTHORIZATION

### Shibboleth Integration

**Production Environment** (`https://apps.library.caltech.edu/content-dashboard/`):

- Shibboleth Service Provider (SP) is configured at the Apache level (inside the existing apps.library.caltech.edu vhost)
- **No authentication code needed in datasetd or our application**
- datasetd will run behind the Shibboleth-protected web server
- Static files in `htdocs/` are served only to authenticated users
- API endpoints are also protected by Shibboleth
- Apache forwards the authenticated user's identity to backend services via the `REMOTE_USER` environment variable, which can be passed as a request header to the Deno proxy using `RequestHeader set Remote-User "%{REMOTE_USER}e"`

**Shibboleth Benefits**:

- ✅ Single Sign-On across Caltech systems
- ✅ No custom auth code to maintain
- ✅ Leverages existing campus infrastructure
- ✅ Centralized user management
- ✅ Audit logging at infrastructure level

**`updatedBy` Identity from Shibboleth**:

When Apache's mod_shib authenticates a user it sets the `REMOTE_USER` environment variable. The Apache config must forward this to the backend proxy as a request header:

```apache
RequestHeader set Remote-User "%{REMOTE_USER}e"
```

The Deno backend proxy reads `Remote-User` from the request headers and exposes it via `GET /api/whoami`. The frontend calls this on load and stores the user identity for inclusion in `updatedBy` fields when saving stewardship or audit records.

**Development note**: In development there is no Shibboleth session, so `REMOTE_USER` will not be set. The `/api/whoami` endpoint falls back to the `DEV_USER` environment variable, defaulting to `"dev-user"`. This means `updatedBy` records in development will show `"dev-user"` rather than a real user identity — expected behaviour.

**How to confirm `updatedBy` is working in production**:

1. Deploy and authenticate via Shibboleth
2. Open browser DevTools → Network tab
3. Look for the `GET /content-dashboard/api/whoami` request made on page load
4. Verify the response `{ "user": "jdoe@caltech.edu" }` contains your Caltech email
5. Make a stewardship or audit change and check that the saved record has the correct `updatedBy` value
6. If `whoami` returns `"dev-user"`, check that `ShibUseHeaders On` (or equivalent) is set in the Apache Shibboleth config and that the `RequestHeader set Remote-User` line is inside the `<Location>` block

### LibGuides API Access

**Current Status**: Using OAuth with client credentials  
**Question**: Does LibGuides API support Shibboleth?  
**Answer**: **TBD - Needs investigation**

#### Scenario A: LibGuides API Supports Shibboleth

If LibGuides API accepts Shibboleth authentication:

```
┌───────────────┐    ┌─────────────┐    ┌──────────────┐
│  Browser      │───▶│ Shibboleth  │───▶│ LibGuides    │
│  (datasetd)   │    │   SP        │    │   API        │
└───────────────┘    └─────────────┘    └──────────────┘
```

- **Pros**: Simplest architecture, no OAuth management
- **Cons**: Requires LibGuides API Shibboleth support confirmation

#### Scenario B: LibGuides API Requires OAuth Only

If LibGuides API only supports OAuth (current situation):

**Option 1**: Backend Proxy Service (Recommended)

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Browser    │───▶│ datasetd    │    │             │
│             │    │             │    │             │
└─────────────┘    └─────┬───────┘    │  Backend    │
                         │             Proxy        │
                         │             (Deno/TS)    │
                         │    ┌─────────────────────┼──────────────────┐
                         │    │ Shibboleth → OAuth  │                  │
                         │    │  Token Exchange     │                  │
                         └────┴─────────────────────┴──────────────────┘
                                                    │
                                            ┌───────▼───────┐
                                            │ LibGuides API │
                                            │   (OAuth)     │
                                            └───────────────┘
```

**Proxy Service Responsibilities**:
- Accept requests from authenticated users (Shibboleth-protected)
- Manage OAuth token for LibGuides API
- Proxy LibGuides API requests
- Strip PII from responses
- Cache responses to reduce API calls

**Option 2**: Direct Browser with OAuth

```
┌─────────────┐    ┌──────────────┐
│ Browser     │───▶│ LibGuides API│
│ (JavaScript)│    │  (OAuth)     │
└─────────────┘    └──────────────┘
```

- **Pros**: Simpler architecture
- **Cons**: OAuth client credentials exposed in browser code
- **Risk**: Security vulnerability - client secrets would be visible
- **Verdict**: **NOT RECOMMENDED**

### Recommendation

**Implement Scenario B, Option 1**: Backend Proxy Service

**Rationale**:

1. OAuth client credentials must remain server-side
2. PII stripping is still required
3. Caching layer benefits performance
4. Centralized error handling
5. Future flexibility for API changes

**Action Required**: Confirm with LibGuides/Springshare whether API supports Shibboleth authentication.

---

## 🗄️ DATASET CONFIGURATION

### Datasetd Settings with Models Package

**Primary Configuration File**: `content_dashboard.yaml`

**Important**: Datasetd v2.4.1+ integrates with the `github.com/caltechlibrary/models` Go package, which provides **YAML-based model definitions** for robust data validation. Models are defined using HTML5 form element types and include validation patterns, required fields, and data type constraints.

The models package supports:

- Form element types (text, number, date, datetime-local, email, url, checkbox, radio, select, textarea, etc.)
- Validation patterns (regex)
- Required field markers
- Primary ID indicators
- Option lists for select elements
- Custom data types via `Model.Define()`

```yaml
# content_dashboard.yaml
# datasetd configuration for Content Dashboard

# Server configuration
host: "localhost:8200"
htdocs: "./htdocs"  # Serve static files from htdocs directory (optional; Apache can serve these directly)

# ============================================================================
# SCHEMAS (YAML-based models using github.com/caltechlibrary/models package)
# ============================================================================
# Define global schemas here; collections reference them by name via schema: key.
# pattern: and options: are element-level fields (not inside attributes:).
# required: true goes inside attributes: as a string-coercible bool.
# The Generator field can auto-populate timestamps (e.g. generator: "now").
# ============================================================================

schemas:
  stewardship_model:
    id: stewardship_model
    description: |
      Model for content stewardship assignments. Each entry represents
      the expert and editor assignments for a LibGuides page.
    elements:
      - id: pageId
        type: text
        attributes:
          name: pageId
          required: true
        pattern: "^[0-9]+$"
        is_primary_id: true
        label: "Page ID"

      - id: expert
        type: text
        attributes:
          name: expert
        label: "Expert"

      - id: editor
        type: text
        attributes:
          name: editor
        label: "Editor"

      - id: department
        type: select
        attributes:
          name: department
        options:
          - {"": "Unassigned"}
          - {"Archives": "Archives"}
          - {"ACS": "ACS"}
          - {"CLOPS": "CLOPS"}
          - {"DLD": "DLD"}
          - {"LIT": "LIT"}
          - {"RS": "RS"}
        label: "Department"

      - id: lastUpdated
        type: datetime-local
        attributes:
          name: lastUpdated
          required: true
        generator: "now"
        label: "Last Updated"

      - id: updatedBy
        type: text
        attributes:
          name: updatedBy
        label: "Updated By"

  audit_model:
    id: audit_model
    description: |
      Model for audit check results. Each entry tracks the audit status
      (links, accessibility, accuracy) for a page or guide.
    elements:
      - id: type
        type: select
        attributes:
          name: type
          required: true
        options:
          - {"page": "Page"}
          - {"guide": "Guide"}
        is_primary_id: true
        label: "Content Type"

      - id: id
        type: text
        attributes:
          name: id
          required: true
        pattern: "^[0-9]+$"
        is_primary_id: true
        label: "ID"

      - id: links
        type: checkbox
        attributes:
          name: links
          required: true
        label: "Links Check Passed"

      - id: accessibility
        type: checkbox
        attributes:
          name: accessibility
          required: true
        label: "Accessibility Check Passed"

      - id: accuracy
        type: checkbox
        attributes:
          name: accuracy
          required: true
        label: "Accuracy Check Passed"

      - id: updatedAt
        type: datetime-local
        attributes:
          name: updatedAt
          required: true
        generator: "now"
        label: "Audit Updated"

      - id: updatedBy
        type: text
        attributes:
          name: updatedBy
        label: "Updated By"

# Collections — note: list format (- dataset: ...), not a mapping.
# schema: references a key from the schemas: map above.
# Arrow operators (->, ->>) require SQLite 3.38+; SQLite booleans are 0/1.
collections:
  - dataset: stewardship.ds
    schema: stewardship_model
    validate: true
    keys: true
    read: true
    create: true
    update: true
    delete: true
    query:
      by_expert: |
        SELECT src FROM content_stewardship WHERE src->>'expert' = ?
      by_editor: |
        SELECT src FROM content_stewardship WHERE src->>'editor' = ?
      by_department: |
        SELECT src FROM content_stewardship WHERE src->>'department' = ?
      unassigned: |
        SELECT src FROM content_stewardship
        WHERE (src->>'expert' IS NULL OR src->>'expert' = '')
          AND (src->>'editor' IS NULL OR src->>'editor' = '')
      needs_update: |
        SELECT src FROM content_stewardship
        WHERE src->>'lastUpdated' < datetime('now', '-365 days')

  - dataset: audit.ds
    schema: audit_model
    validate: true
    keys: true
    read: true
    create: true
    update: true
    delete: true
    query:
      by_type: |
        SELECT src FROM content_audit WHERE src->>'type' = ?
      by_id: |
        SELECT src FROM content_audit WHERE src->>'id' = ?
      by_type_and_id: |
        SELECT src FROM content_audit WHERE src->>'type' = ? AND src->>'id' = ?
      stale_audits: |
        SELECT src FROM content_audit
        WHERE src->>'updatedAt' < datetime('now', '-90 days')
      incomplete: |
        SELECT src FROM content_audit
        WHERE src->>'links' = 0
           OR src->>'accessibility' = 0
           OR src->>'accuracy' = 0
```

> **Note on testing**: The `schemas:` / `schema:` / `validate:` configuration is part of the models integration in the latest dataset. Test this in development before deploying — confirm that validation rejects bad data, pattern matching works, and required fields are enforced. The `generator: "now"` field for auto-timestamping should also be tested.

### Collection Initialization

**stewardship.ds** and **audit.ds**

These directories will be automatically created by datasetd when first used, or can be initialized with:

```bash
# Initialize collections
dataset init stewardship.ds
dataset init audit.ds

# Or let datasetd create them on first request
```

### Datasetd Deployment Options

**Development**:

```bash
# Run datasetd in development
datasetd -c content_dashboard.yaml
```

**Production**:

- Run as system service on server behind Shibboleth
- Port: 8200
- HTTPS: Terminated at web server level (Shibboleth SP)

---

## 🔧 MIDDLEWARE ASSESSMENT

### Requirement Analysis

| **Requirement** | **datasetd Feature** | **Middleware Needed?** | **Decision** |
|----------------|---------------------|------------------------|--------------|
| Data Validation | Schema validation with `validate: true` | ❌ No | ✅ Use datasetd |
| CRUD Operations | Built-in REST API | ❌ No | ✅ Use datasetd |
| Query Capability | SQL queries in YAML | ❌ No | ✅ Use datasetd |
| CORS Support | Limited (needs proxy) | ⚠️ Maybe | See below |
| Authentication | None built-in | ✅ Yes | Shibboleth at web server |
| Authorization | None built-in | ✅ Yes | Shibboleth at web server |
| LibGuides Proxy | None | ✅ Yes | **Backend Proxy Service** |
| PII Stripping | None | ✅ Yes | **Backend Proxy Service** |

### Decision: NO Custom Middleware for CRUD

**Rationale**: datasetd v2.4.1+ provides all necessary validation features through the **models package** (`github.com/caltechlibrary/models`):

- ✅ **Robust schema validation** - The models package uses HTML5 form element types (text, number, date, datetime-local, email, url, checkbox, radio, select, textarea, etc.) with validation patterns, required field markers, and primary ID indicators
- ✅ **YAML-based model definitions** - Models are defined in YAML format in the configuration file, making them easy to read and maintain
- ✅ **Server-side validation** - Validation happens in Go before data is stored, providing strong type safety
- ✅ **Reusable models** - Models can be defined globally and referenced by multiple collections
- ✅ **RESTful JSON API** (GET, POST, PUT, DELETE)
- ✅ **SQL query support** (for complex reporting)
- ✅ **Collection-level permissions**
- ✅ **Standard JSON content type support**

**This is a NEW FEATURE** that was confirmed to be available in datasetd v2.4.1+ and makes custom validation middleware unnecessary.

**Testing Required**: Since this is a newer feature, we should test that:

1. Model validation properly rejects invalid data
2. Pattern matching works as expected (e.g., numeric page IDs)
3. Required fields are enforced
4. Primary ID fields are handled correctly

### Required: Backend Proxy Service

**Purpose**: Handle LibGuides API integration

**Technology**: Deno + TypeScript (as suggested)

**Location**: Separate service or integrated?

**Recommendation**: **Separate backend service** (not middleware)

```
┌─────────────────────┐     ┌───────────────────────┐    ┌───────────────────┐
│  Browser            │────▶│ datasetd              │    │ Backend Proxy     │
│  (static)           │     │ - dataset collections │    │ (Deno+TypeScript) │
└─────────────────────┘     └───────────────────────┘    │ - LibGuides API   │
        │                                     │          │ - OAuth           │
        │                                     │          │ - PII stripping   │
        │ (Shibboleth protected)              │          │ - Caching         │
        └───────────────────────────────────────────────▶│                   │
                                                         └────────┬──────────┘
                                                                  │
                                                              ┌───▼─────┐
                                                              │LibGuides│
                                                              │  API    │
                                                              └─────────┘
```

**Backend Proxy Service Endpoints**:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/whoami` | Return Shibboleth-authenticated user identity |
| GET | `/api/libguides/accounts` | Get accounts (PII stripped) |
| GET | `/api/libguides/guides` | Get guides with expansion |
| GET | `/api/libguides/guides/unpublished` | Get unpublished guides |

**Implementation Options**:

1. **Separate Deno Service**: Standalone service on different port
2. **Integrated into datasetd**: Custom routes (requires datasetd modification)
3. **Nginx/Apache Proxy**: URL rewrite rules

**Recommendation**: Separate Deno service (most flexible, easiest to maintain)

### Why Not Middleware?

The term "middleware" typically implies:

- Interception of requests/responses
- Transformation before/after processing
- Shared logic across multiple endpoints

In our case:

- **datasetd already handles dataset operations** perfectly
- **LibGuides proxy is a separate concern** (different data source)
- **No request/response transformation** needed for dataset operations
- **Schema validation is built into datasetd**

Therefore: **No middleware needed**. The backend proxy is a **separate service**, not middleware.

---

## 📊 DATA SCHEMAS & MIGRATION

### Current Data Structures

#### Cloudflare KV: Stewardship

**Key**: `steward:{pageId}`

**Value**:

```json
{
  "expert": "Tony Diaz",
  "editor": "Penny Neder-Muro",
  "department": "Archives"
}
```

#### Cloudflare KV: Audit

**Key**: `{type}:{id}` (e.g., `page:8997487`, `guide:26856`)

**Value**:

```json
{
  "links": true,
  "accessibility": false,
  "accuracy": true,
  "updatedAt": "2026-01-15T10:30:00.000Z"
}
```

### Target Data Structures (Dataset)

#### Collection: stewardship.ds

**Key**: `{pageId}` (e.g., `8997487`)

**Value** (enhanced schema):

```json
{
  "pageId": "8997487",
  "expert": "Tony Diaz",
  "editor": null,
  "department": "Archives",
  "lastUpdated": "2026-05-28T12:00:00Z",
  "updatedBy": "admin"
}
```

**Changes from Current**:

- Key simplified from `steward:{pageId}` to `{pageId}`
- Added `lastUpdated` and `updatedBy` fields
- Empty strings (`""`) normalized to `null`
- `pageId` included in value for self-documenting records

#### Collection: audit.ds

**Key**: `{type}:{id}` (e.g., `page:8997487`, `guide:26856`)

**Value** (enhanced schema):

```json
{
  "type": "page",
  "id": "8997487",
  "links": true,
  "accessibility": false,
  "accuracy": true,
  "updatedAt": "2026-05-28T10:30:00Z",
  "updatedBy": "staff1"
}
```

**Changes from Current**:

- Added `type` and `id` fields in value (key already contains this)
- Added `updatedBy` field
- Structure matches datasetd conventions

### Migration Script

We need to migrate the `stewardship.json` file JSONL so we can load it into our dataset stewardship.ds collection.

**File**: `convert_stewardships.bash`

```bash
#!/bin/bash
# Convert stewardship.json to stewardship.jsonl for dataset loading
# Usage: ./convert_stewardship.sh

jq -c 'to_entries[] | {key: .key, object: .value}' stewardship.json > stewardship.jsonl

echo "Converted stewardship.json to stewardship.jsonl"
echo "Lines generated: $(wc -l < stewardship.jsonl)"
```

Loading the data is done with dataset itself.

```shell
dataset load stewardship.ds < stewardship.jsonl
```

---

## 🎨 FRONTEND MODIFICATIONS

### Configuration Approach

**`htdocs/config.js` is removed entirely.**

All configuration lives in `content_dashboard.yaml` at the repo root — a single source of truth for datasetd, the Deno proxy, and the browser. The Deno proxy reads this file at startup and exposes the browser-relevant subset via `GET /api/config` as JSON.

`app.js` calls `loadConfig()` before any other data fetch, stores the result in a module-level `CONFIG` object, and proceeds as before.

**Browser-visible config keys returned by `GET /api/config`**:

```json
{
  "stale_days": 365,
  "very_stale_days": 730,
  "session_key": "cs_guides_v1",
  "website_page_groups": [26856, 27077],
  "research_guide_groups": [10729],
  "departments": ["Archives", "ACS", "CLOPS", "DLD", "LIT", "RS"]
}
```

URL prefixes (`DATASETD_URL`, `PROXY_URL`) are **not** in the config response — the browser uses relative paths (`/content-dashboard/api/...`) in production and configurable dev overrides set via a small `htdocs/dev-config.js` excluded from the repo (gitignored). In production no dev override file exists and defaults are relative paths.

**`content_dashboard.yaml` additions for the proxy**:

```yaml
# Browser-facing configuration (served via GET /api/config)
browser_config:
  stale_days: 365
  very_stale_days: 730
  session_key: "cs_guides_v1"
  website_page_groups: [26856, 27077]
  research_guide_groups: [10729]
  departments: ["Archives", "ACS", "CLOPS", "DLD", "LIT", "RS"]

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
    ttl: 3600
```

### Data Loading Updates

**File**: `htdocs/app.js` - Key changes

**OLD**: Cloudflare KV via Worker

```javascript
// Load stewardship
const sr = await fetch(`${CONFIG.WORKER_URL}/stewardship`);

// Load audit
const ar = await fetch(`${CONFIG.WORKER_URL}/audit`);
```

**NEW**: Direct datasetd API

```javascript
// Load stewardship
async function loadStewardship() {
  const keysResponse = await fetch(
    `${CONFIG.DATASETD_URL}/api/${CONFIG.STEWARDSHIP_COLLECTION}/keys`
  );
  const keys = await keysResponse.json();
  
  const stewardship = {};
  await Promise.all(keys.map(async (key) => {
    const response = await fetch(
      `${CONFIG.DATASETD_URL}/api/${CONFIG.STEWARDSHIP_COLLECTION}/object/${key}`
    );
    if (response.ok) {
      const data = await response.json();
      stewardship[key] = data;
    }
  }));
  return stewardship;
}

// Load audit
async function loadAudit() {
  const keysResponse = await fetch(
    `${CONFIG.DATASETD_URL}/api/${CONFIG.AUDIT_COLLECTION}/keys`
  );
  const keys = await keysResponse.json();
  
  const audit = {};
  await Promise.all(keys.map(async (key) => {
    const response = await fetch(
      `${CONFIG.DATASETD_URL}/api/${CONFIG.AUDIT_COLLECTION}/object/${key}`
    );
    if (response.ok) {
      const data = await response.json();
      audit[key] = data;
    }
  }));
  return audit;
}

// Fetch authenticated user identity from backend proxy (reads Shibboleth REMOTE_USER).
// In development, returns DEV_USER env var or "dev-user". Call once on page load.
async function loadCurrentUser() {
  try {
    const resp = await fetch(`${CONFIG.PROXY_URL}/api/whoami`);
    if (resp.ok) {
      const data = await resp.json();
      CONFIG.currentUser = data.user || 'unknown';
    }
  } catch {
    CONFIG.currentUser = 'unknown';
  }
}

// Save stewardship
async function saveStewardship(pageId, data) {
  const entry = { ...data, updatedBy: CONFIG.currentUser };
  // lastUpdated is auto-populated by datasetd via generator: "now" on the model
  await fetch(
    `${CONFIG.DATASETD_URL}/api/${CONFIG.STEWARDSHIP_COLLECTION}/object/${pageId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }
  );
}

// Save audit
async function saveAudit(type, id, checks) {
  const key = `${type}:${id}`;
  const entry = { type, id, ...checks, updatedBy: CONFIG.currentUser };
  // updatedAt is auto-populated by datasetd via generator: "now" on the model
  await fetch(
    `${CONFIG.DATASETD_URL}/api/${CONFIG.AUDIT_COLLECTION}/object/${key}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }
  );
}

// Reset audit by prefix — datasetd has no bulk-delete, so list then delete individually.
// Replaces the old Worker DELETE /audit { prefix } endpoint.
async function resetAuditByPrefix(prefix) {
  const keysResp = await fetch(
    `${CONFIG.DATASETD_URL}/api/${CONFIG.AUDIT_COLLECTION}/keys`
  );
  if (!keysResp.ok) return;
  const keys = await keysResp.json();
  const matching = keys.filter(k => k.startsWith(prefix));
  await Promise.all(matching.map(key =>
    fetch(`${CONFIG.DATASETD_URL}/api/${CONFIG.AUDIT_COLLECTION}/object/${encodeURIComponent(key)}`, {
      method: 'DELETE'
    })
  ));
}
```

### LibGuides Data Loading

**File**: `htdocs/app.js` - LibGuides proxy calls

**OLD**: Via Worker

```javascript
// Load accounts
const ar = await fetch(`${CONFIG.WORKER_URL}/accounts`);

// Load guides
const res = await fetch(`${CONFIG.WORKER_URL}/guides?status=1&expand=pages,pages.boxes,owner`);
```

**NEW**: Via Backend Proxy

```javascript
// Load accounts (via backend proxy)
async function loadAccounts() {
  const response = await fetch(
    `${CONFIG.PROXY_URL}/api/libguides/accounts`
  );
  if (response.ok) {
    const accounts = await response.json();
    // Process accounts (same as before)
    return accounts.filter(a => {
      if (!a.first_name && !a.last_name) return false;
      const email = (a.email || '').toLowerCase();
      if (email.endsWith('@springshare.com')) return false;
      if ((a.last_name || '').includes('(test)')) return false;
      if (email.includes('+')) return false;
      return true;
    }).map(a => `${a.first_name} ${a.last_name}`.trim())
      .filter(Boolean).sort((a,b) => a.localeCompare(b));
  }
  return [];
}

// Load guides (via backend proxy)
async function loadGuides(status = 1, expand = 'pages,pages.boxes,owner') {
  const response = await fetch(
    `${CONFIG.PROXY_URL}/api/libguides/guides?status=${status}&expand=${expand}`
  );
  if (!response.ok) {
    throw new Error(`Guides API: HTTP ${response.status}`);
  }
  return await response.json();
}
```

---

## 🌐 BACKEND PROXY SERVICE (DENO+TYPESCRIPT)

> **Status (2026-06-12)**: Implemented as `proxy/{main,config,routes,libguides}.ts`, structured
> differently than the design sketch below — config is loaded from `content_dashboard.yaml`'s
> `proxy:` section (see `proxy/config.ts`), not a separate `backend-config.yaml`. The
> "Environment Variables", "Docker Configuration", and "Service Management" subsections have
> been updated to match the actual implementation and deployment; the rest of this section is
> historical design notes.

### Service Overview

**Technology**: Deno + TypeScript  
**Purpose**: Proxy LibGuides API with OAuth, PII stripping, and caching  
**Location**: Separate service (can run on same server as datasetd)

### Service Configuration

**File**: `backend-config.yaml` or environment variables

```yaml
# backend-config.yaml
port: 8080
libguides:
  base_url: "https://lgapi-us.libapps.com/1.2"
  client_id: "${LIBGUIDES_CLIENT_ID}"
  client_secret: "${LIBGUIDES_CLIENT_SECRET}"
  token_url: "https://lgapi-us.libapps.com/1.2/oauth/token"
cache:
  enabled: true
  ttl: 3600  # 1 hour
  directory: "./cache"

# Shibboleth integration (if needed for headers)
shibboleth:
  enabled: true
  header_name: "Shib-Identity-Provider"
```

### Service Endpoints

**File**: `backend/main.ts`

```typescript
// main.ts - Backend Proxy Service for LibGuides

import { Application, Router, send } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

interface LibGuidesConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

interface CacheConfig {
  enabled: boolean;
  ttl: number;
  directory: string;
}

// Load configuration
const libguidesConfig: LibGuidesConfig = {
  baseUrl: config().LIBGUIDES_BASE_URL || "https://lgapi-us.libapps.com/1.2",
  clientId: config().LIBGUIDES_CLIENT_ID || "",
  clientSecret: config().LIBGUIDES_CLIENT_SECRET || "",
  tokenUrl: config().LIBGUIDES_TOKEN_URL || "https://lgapi-us.libapps.com/1.2/oauth/token",
};

// Token cache
let accessToken: string | null = null;
let tokenExpiresAt = 0;

// Initialize Oak application
const app = new Application();
const router = new Router();

// OAuth token management
async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  const params = new URLSearchParams({
    client_id: libguidesConfig.clientId,
    client_secret: libguidesConfig.clientSecret,
    grant_type: "client_credentials",
  });

  const response = await fetch(libguidesConfig.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  
  return accessToken;
}

// Proxy to LibGuides accounts with PII stripping
router.get("/api/libguides/accounts", async (ctx) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`${libguidesConfig.baseUrl}/accounts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Accounts API: HTTP ${response.status}`);
    }

    const accounts = await response.json();
    
    // Strip PII - only return id, first_name, last_name
    const safeAccounts = accounts.map(({ id, first_name, last_name }: any) => ({
      id,
      first_name,
      last_name,
    }));

    ctx.response.body = safeAccounts;
    ctx.response.type = "json";
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Proxy to LibGuides guides
router.get("/api/libguides/guides", async (ctx) => {
  try {
    const token = await getAccessToken();
    const { url } = ctx.request;
    const searchParams = new URL(url).search;
    
    const response = await fetch(`${libguidesConfig.baseUrl}/guides${searchParams}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Guides API: HTTP ${response.status}`);
    }

    ctx.response.body = await response.arrayBuffer();
    ctx.response.type = response.headers.get("Content-Type") || "application/json";
    ctx.response.headers.set("Cache-Control", "no-store");
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Who-am-I: returns Shibboleth-authenticated user identity.
// In production, Apache forwards REMOTE_USER as a request header via:
//   RequestHeader set Remote-User "%{REMOTE_USER}e"
// In development (no Shibboleth), falls back to DEV_USER env var or "dev-user".
// The frontend calls this on load and stores the result for use as updatedBy.
router.get("/api/whoami", (ctx) => {
  const remoteUser =
    ctx.request.headers.get("Remote-User") ||
    ctx.request.headers.get("remote-user") ||
    Deno.env.get("DEV_USER") ||
    "dev-user";
  ctx.response.body = { user: remoteUser };
  ctx.response.type = "json";
});

// Health check
router.get("/health", (ctx) => {
  ctx.response.body = { status: "ok", timestamp: new Date().toISOString() };
});

// Use router
app.use(router.routes());
app.use(router.allowedMethods());

// Static file serving (optional - for development)
app.use(async (ctx, next) => {
  try {
    await send(ctx, {
      root: `${Deno.cwd()}/htdocs`,
      index: "index.html",
    });
  } catch {
    await next();
  }
});

// Start server
const PORT = config().PORT || 8080;
console.log(`Backend proxy service running on port ${PORT}`);

await app.listen({ port: parseInt(PORT) });
```

### Environment Variables

Only the LibGuides OAuth credentials are supplied via environment — `port`, `base_url`,
`token_url`, and `cache` settings live in `content_dashboard.yaml`'s `proxy:` section (see
`proxy/config.ts`).

```bash
# .env (mode 600, gitignored)
export LIBGUIDES_CLIENT_ID=your_client_id
export LIBGUIDES_CLIENT_SECRET=your_client_secret
```

In development this is loaded via `deno run --env-file=.env` (the `proxy`/`proxy-dev` tasks
in `deno.json`). In production it is loaded via systemd's `EnvironmentFile=` — see Service
Management below. `DEV_USER` may also be set in development to control the `/api/whoami`
response when no `Remote-User` header is present; it must not be set in production.

### Docker Configuration

Not used. The proxy is compiled to a native binary with `deno compile` (`make compile-proxy`,
output `bin/content-dashboard-proxy`) and run directly under systemd — see Service Management
below.

---

## 📋 DEPLOYMENT ARCHITECTURE

### Production Deployment

**Target URL**: `https://apps.library.caltech.edu/content-dashboard/`

```
┌─────────────────────────────────────────────────────────────────┐
│           apps.library.caltech.edu (Apache + Shibboleth SP)     │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  HTTPS:443      │    │  Shibboleth SP  │                     │
│  │  /content-      │───▶│  (AuthN/AuthZ)  │                     │
│  │  dashboard/     │    │  REMOTE_USER    │                     │
│  └─────────────────┘    └────────┬────────┘                     │
│        ▲                         │ RequestHeader Remote-User    │
│        │                  ┌──────▼──────────────────────┐       │
│        │                  │  datasetd :8200             │       │
│        │                  │  - htdocs/ (static files)   │       │
│        │                  │  - /api/... (JSON API)      │       │
│        │                  └─────────────────────────────┘       │
│        │                                                         │
│        │    ┌─────────────────────────────────────────────┐     │
│        │    │  Backend Proxy (Deno+TypeScript) :8080      │     │
│        │    │  - /api/libguides/... (OAuth proxy)         │     │
│        └────│  - /api/whoami      (Shibboleth identity)   │     │
│             └──────────────────────────┬────────────────--┘     │
│                                        │                        │
│               ┌────────────────────────▼──────────────┐        │
│               │   LibGuides API (External)            │        │
│               │   https://lgapi-us.libapps.com        │        │
│               └───────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration Files

**Apache Configuration**:

The canonical config snippet is `etc/content-dashboard.conf-example` in this repository. It goes inside the existing `<VirtualHost *:443>` block for `apps.library.caltech.edu`; the system administrator will provide the final configuration.

```apache
#<!-- content-dashboard -->
ProxyPreserveHost On

# Redirect bare path to trailing-slash form
Redirect "/content-dashboard" "/content-dashboard/"

# --- content-dashboard-proxy (:8080) ---
# proxy/routes.ts matches on the full request path, including the
# /content-dashboard prefix, so it must be preserved (no path rewrite).
ProxyPass        "/content-dashboard/api/config"     "http://localhost:8080/content-dashboard/api/config"     retry=0
ProxyPassReverse "/content-dashboard/api/config"     "http://localhost:8080/content-dashboard/api/config"
ProxyPass        "/content-dashboard/api/whoami"     "http://localhost:8080/content-dashboard/api/whoami"     retry=0
ProxyPassReverse "/content-dashboard/api/whoami"     "http://localhost:8080/content-dashboard/api/whoami"
ProxyPass        "/content-dashboard/api/health"     "http://localhost:8080/content-dashboard/api/health"     retry=0
ProxyPassReverse "/content-dashboard/api/health"     "http://localhost:8080/content-dashboard/api/health"
ProxyPass        "/content-dashboard/api/libguides/" "http://localhost:8080/content-dashboard/api/libguides/" retry=0
ProxyPassReverse "/content-dashboard/api/libguides/" "http://localhost:8080/content-dashboard/api/libguides/"

# --- content-dashboard-api / datasetd (:8200) ---
# Serves htdocs/ static files and the dataset JSON API (stewardship, audit).
# datasetd has no /content-dashboard prefix of its own, so it is stripped here.
# Must come after the more specific ProxyPass rules above.
ProxyPass        "/content-dashboard/" "http://localhost:8200/" retry=0
ProxyPassReverse "/content-dashboard/" "http://localhost:8200/"

#<!-- content-dashboard access control -->
<Location /content-dashboard/>
  AuthType shibboleth
  ShibRequestSetting requireSession 1
  require valid-user
  #require user rsdoiel@caltech.edu
  RequestHeader set Remote-User "%{REMOTE_USER}e"
</Location>
#<!-- end content-dashboard -->
```

> **Note**: `REMOTE_USER` is set by Apache from the Shibboleth-authenticated session and forwarded as the `Remote-User` header to the backend proxy. The Deno service reads this in `/content-dashboard/api/whoami` to supply `updatedBy` data. No `ShibUseHeaders` directive is needed for this approach — it uses Apache's own `REMOTE_USER` env var, not raw Shibboleth attribute headers.

### Service Management

Deployment follows the `/Sites/<repo>` convention used for other Caltech Library
Deno+TypeScript services (see the `cold` project). The repository is cloned to
`/Sites/content-dashboard`; the proxy is compiled to `bin/content-dashboard-proxy` via
`make compile-proxy` (or `deno task compile-proxy`).

**Systemd Service for datasetd**:

```ini
# /etc/systemd/system/datasetd-content-dashboard.service

[Unit]
Description=datasetd service for Content Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/Sites/content-dashboard
ExecStart=/usr/local/bin/datasetd content_dashboard.yaml
Restart=always

[Install]
WantedBy=multi-user.target
```

**Systemd Service for the Content Dashboard Proxy**:

The canonical unit file is `etc/content-dashboard-proxy.service` in this repository:

```ini
# /etc/systemd/system/content-dashboard-proxy.service

[Unit]
Description=Content Dashboard Proxy service
After=network.target
ConditionPathExists=!/Sites/content-dashboard/content-dashboard-proxy_not_to_be_run

[Service]
WorkingDirectory=/Sites/content-dashboard
EnvironmentFile=/Sites/content-dashboard/.env
ExecStart=/Sites/content-dashboard/bin/content-dashboard-proxy content_dashboard.yaml
Type=simple
Restart=always

[Install]
WantedBy=multi-user.target
Alias=content-dashboard-proxy.service
```

`LIBGUIDES_CLIENT_ID`/`LIBGUIDES_CLIENT_SECRET` come from `/Sites/content-dashboard/.env`
(mode 600, `export KEY=value` lines — systemd 246+, present on Ubuntu 24.04, strips the
`export` prefix automatically). `DEV_USER` must not be set in production; `/api/whoami`
falls back to the `Remote-User` header set by Apache/Shibboleth.

---

## 🔄 MIGRATION TIMELINE

### Phase 1: Preparation & Analysis (COMPLETE)

- [x] Analyze current architecture
- [x] Document Cloudflare KV structures
- [x] Document LibGuides API interactions
- [x] Define dataset schemas
- [x] Assess middleware needs
- [x] Document authentication requirements

### Phase 2: Repository Restructuring (1-2 days)

- [ ] Create new directory structure
- [ ] Move browser files to htdocs/
- [ ] Create datasetd configuration (content_dashboard.yaml)
- [ ] Create operator/admin documentation
- [ ] Create collection initialization scripts
- [ ] Update GitHub Pages configuration
- [ ] Remove Cloudflare-specific files

### Phase 3: Dataset Collections Setup (1 day)

- [ ] Install datasetd on development machine
- [ ] Create collections directory
- [ ] Initialize stewardship.ds collection
- [ ] Initialize audit.ds collection
- [ ] Test datasetd API with sample data
- [ ] Create migration script for existing data

### Phase 4: Backend Proxy Service (2-3 days)

- [ ] Set up Deno environment
- [ ] Implement OAuth token management
- [ ] Implement accounts endpoint with PII stripping
- [ ] Implement guides endpoints with caching
- [ ] Add error handling and logging
- [ ] Create Dockerfile (optional)
- [ ] Test with LibGuides API

### Phase 5: Frontend Migration (3-5 days)

- [ ] Update config.js for datasetd
- [ ] Replace Worker KV calls with datasetd API calls
- [ ] Replace Worker LibGuides proxy with backend proxy calls
- [ ] Update all data loading functions
- [ ] Update all data saving functions
- [ ] Test stewardship CRUD operations
- [ ] Test audit CRUD operations
- [ ] Test all views (Website Pages, Research Guides, Reports, Assign Roles)
- [ ] Test caching behavior

### Phase 6: Integration & Testing (2-3 days)

- [ ] End-to-end testing with development datasetd
- [ ] Test with backend proxy service
- [ ] Validate data migration from Cloudflare KV
- [ ] Performance testing
- [ ] Error handling testing
- [ ] Browser compatibility testing

### Phase 7: Production Deployment (1-2 days)

- [ ] Deploy datasetd on production server
- [ ] Deploy backend proxy service
- [ ] Configure Apache/Nginx with Shibboleth
- [ ] Configure proxy rules
- [ ] Migrate production data from Cloudflare KV
- [ ] Deploy updated frontend to htdocs/
- [ ] Smoke testing
- [ ] User acceptance testing

### Phase 8: Cutover & Monitoring (1 day)

- [ ] DNS configuration (if needed)
- [ ] Final data migration
- [ ] User communication
- [ ] Monitoring setup
- [ ] Rollback plan

**Total Estimated Time**: 10-15 days (elapsed time, not person-days)

---

## 📝 DOCUMENTATION PLAN

### Operator Documentation (`OPERATOR_GUIDE.md`)

```markdown
# Content Dashboard: Operator Guide

## Daily Operations
- Starting/stopping services
- Monitoring service health
- Checking logs
- Backup procedures

## Common Tasks
- Adding new staff to system
- Running reports
- Exporting data
- Managing stewardship assignments

## Troubleshooting
- Common errors and solutions
- Log file locations
- Contact information for support
```

### Administrator Documentation (`ADMINISTRATOR_GUIDE.md`)

```markdown

# Content Dashboard: Administrator Guide

## Installation

- Prerequisites
- Installation steps
- Configuration

## Configuration Management

- datasetd configuration
- Backend proxy configuration
- Web server configuration
- Shibboleth configuration

## Data Management

- Collection initialization
- Data migration
- Backup and restore
- Data validation

## User Management

- Access control (via Shibboleth)
- Role management (application-level)
- Auditing

## Maintenance

- Software updates
- Database maintenance
- Performance tuning
- Monitoring setup

```

### Architecture Documentation (`ARCHITECTURE.md`)

```markdown

# Content Dashboard: Architecture

## System Overview

- High-level architecture diagram
- Component descriptions
- Data flow diagrams

## Components

- Frontend (htdocs/)
- datasetd Service
- Backend Proxy Service
- Web Server (Apache/Nginx)
- Shibboleth Integration
- LibGuides API

## Data Model

- Collection schemas
- Data relationships
- Storage format

## Security Model

- Authentication flow
- Authorization model
- Data protection

```

---

## ✅ DECISIONS & RECOMMENDATIONS

### ✅ Confirmed Decisions

| **Decision** | **Rationale** | **Impact** |
|-------------|--------------|------------|
| Use datasetd for data storage | Provides all needed CRUD + query features | Simplifies backend |
| No custom middleware for CRUD | datasetd has built-in validation and queries | Less code to maintain |
| Repository restructuring with htdocs/ | Standard convention, clear separation | Better organization |
| Backend proxy for LibGuides | OAuth credentials must stay server-side | Security requirement |
| Shibboleth for frontend auth | Existing campus infrastructure | No custom auth code |
| Keep current frontend caching | Already works well, reduces API calls | Better performance |

### ⚠️ Open Questions

| **Question** | **Status** | **Impact** | **Action Required** |
|-------------|------------|------------|-------------------|
| Does LibGuides API support Shibboleth? | TBD | Could eliminate OAuth proxy | Confirm with Springshare |
| Can we use Shibboleth for LibGuides API? | TBD | Architecture simplification | Test with LibGuides support |
| What are the rate limits for LibGuides API? | TBD | Caching strategy | Check API documentation |
| Does `generator: "now"` auto-timestamp work in latest datasetd? | TBD | Simplifies frontend code | Test in development |
| Does `validate: true` + `schema:` work in latest datasetd? | TBD | Core "no middleware" assumption | Test in development |

### 🎯 Recommendations

1. **Proceed with current plan** - Datasetd + backend proxy is solid approach
2. **Confirm LibGuides API authentication** - Critical for architecture finalization
3. **Implement incrementally** - Start with development datasetd, then add proxy, then frontend
4. **Maintain Cloudflare deployment temporarily** - Allow for parallel testing
5. **Plan for zero-downtime migration** - Users should not notice the cutover

---

## 📞 CONTACTS & RESOURCES

### Internal Contacts

- **Project Lead**: [TBD]
- **System Administrator**: [TBD]
- **LibGuides Administrator**: [TBD]
- **Shibboleth Support**: [TBD]

### External Resources

- **LibGuides/Springshare Support**: https://support.springshare.com/
- **dataset Project**: https://github.com/caltechlibrary/dataset
- **datasetd Documentation**: [In dataset repository]
- **Deno**: https://deno.land/
- **Shibboleth**: https://www.shibboleth.net/

### Dependencies

- **datasetd**: v2.4.1 or later
- **Deno**: v1.40.0 or later
- **SQLite**: v3.39.0 or later (for datasetd storage)
- **Apache/Nginx**: Latest stable version with Shibboleth SP
- **Shibboleth SP**: v3.0 or later

---

## 🎓 NEXT STEPS

### Immediate Actions (This Week)

1. **Confirm LibGuides API authentication options**
   - Contact Springshare support
   - Test Shibboleth with LibGuides API
   - Document findings
2. **Set up development environment**
   - Install datasetd
   - Install Deno
   - Create development directories
3. **Repository restructuring**
   - Create new directory structure
   - Move files to htdocs/
   - Create initial configuration files

### Short-term Actions (Next 2 Weeks)

1. **Implement datasetd collections**
   - Create stewardship.ds
   - Create audit.ds
   - Test with sample data
2. **Create migration scripts**
   - Export from Cloudflare KV
   - Transform to dataset format
   - Import to datasetd
3. **Implement backend proxy service**
   - Deno + TypeScript setup
   - OAuth token management
   - PII stripping logic
   - Basic endpoints

### Medium-term Actions (Next Month)

1. **Frontend migration**
   - Update configuration
   - Replace Worker calls with datasetd API
   - Replace LibGuides proxy with backend proxy
   - Test all functionality
2. **Integration testing**
   - End-to-end tests
   - Performance tests
   - Error handling tests

---

## 📄 APPENDICES

### Appendix A: Current File Inventory

```
content-dashboard/
├── app.js              # 1549 lines - Frontend application
├── config.js           # 12 lines - Configuration
├── index.html          # 98 lines - HTML structure
├── stewardship.json    # 194 lines - Seed data
├── styles.css          # 18150 bytes - Styling
├── worker.js           # 190 lines - Cloudflare Worker
└── wrangler.toml       # 10 lines - Cloudflare config
```

### Appendix B: Cloudflare KV Data Summary

**Namespace**: AUDIT (11c661f3a1634813bea933f737ccee6c)

**Stewardship Entries**: 45 entries (from stewardship.json)

- Key pattern: `steward:{pageId}`
- Page IDs: 8997487, 8997489, 9007056, ..., 11310049

**Audit Entries**: Unknown (needs export from Cloudflare)

- Key pattern: `{type}:{id}`
- Types: page, guide

**Total KV Data Size**: Estimated < 50KB

### Appendix C: LibGuides API Usage

**Current Worker Endpoints Used**:

- `/accounts` - 1 call on load
- `/guides?status=1&expand=pages,pages.boxes,owner` - 1 call on load (cached)
- `/guides?status=0&expand=pages,owner` - 2 calls on demand (unpublished content)

**API Rate Limiting**: Unknown (needs verification)

**OAuth Token Expiry**: Configurable, typically 1 hour

---

*Document created: 2026-05-28*  
*Status: Analysis & Planning Complete*  
*Next: Implementation Phase*  
*Author: [Migration Team]*
