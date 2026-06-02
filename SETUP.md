# Content Dashboard: Setup Guide

This document covers configuration and setup for operators and developers. It assumes the
repository is already cloned and that the required software (listed below) is installed.

## Architecture summary

Three services run in production, all behind a single Apache virtual host with Shibboleth
authentication:

```
Browser → Apache + Shibboleth (apps.library.caltech.edu)
              │
              ├─ /content-dashboard/api/libguides/  →  Deno proxy  :8080
              ├─ /content-dashboard/api/whoami       →  Deno proxy  :8080
              ├─ /content-dashboard/api/config       →  Deno proxy  :8080
              └─ /content-dashboard/                 →  datasetd    :8200
                                                         (static files + dataset JSON API)
```

In development, Apache and Shibboleth are not involved. The browser speaks directly to
datasetd and the Deno proxy on different ports.

---

## Quick check

Run the setup checker at any point to verify your environment:

```shell
deno task check-setup
```

It prints `setup OK` in green if everything is in order, or reports errors (red)
and warnings (orange) with remediation hints. Exit code is 0 on success, 1 on error.

---

## Prerequisites

| Software | Minimum version | Purpose |
|----------|----------------|---------|
| `datasetd` | 2.4.1 | Data service and static file server |
| `dataset` | 2.4.1 | CLI for initialising and loading collections |
| Deno | 2.8 | Runs the backend proxy service |
| SQLite | 3.38 | Storage engine used by datasetd (`->>` operator required) |

---

## Configuration file: content_dashboard.yaml

All service configuration lives in a single file at the repository root.
Do not commit credentials — supply them via environment variables (see below).

### Top-level server settings

```yaml
host: localhost:8200   # Address datasetd listens on.
                       # Change the port if 8200 is taken on your machine.
                       # In production this stays on localhost; Apache proxies it.

htdocs: htdocs         # Path to the browser-served directory, relative to this file.
                       # Leave as-is unless you move the htdocs/ directory.
```

### schemas and collections

These two sections define the data models and database collections. **Do not change
them** unless you are intentionally extending the data model — any change here must
be matched by corresponding changes to `htdocs/app.js`.

```yaml
schemas:
  stewardship_model: ...   # Fields: pageId, expert, editor, department, lastUpdated, updatedBy
  audit_model:       ...   # Fields: type, id, links, accessibility, accuracy, updatedAt, updatedBy

collections:
  - dataset: stewardship.ds  # Stores page stewardship assignments
  - dataset: audit.ds        # Stores audit check results
```

### browser_config

These values are served to the browser at `GET /api/config` by the Deno proxy.
They replace the old `htdocs/config.js` file.

```yaml
browser_config:
  stale_days: 365          # Pages not updated in this many days are flagged stale.
  very_stale_days: 730     # Pages not updated in this many days are flagged very stale.
  session_key: "cs_guides_v1"  # sessionStorage key for cached guide data.
                               # Increment (e.g. cs_guides_v2) to force a cache bust.

  # LibGuides group IDs that contain website pages (shown in the Website Pages view).
  website_page_groups: [26856, 27077]

  # LibGuides group IDs that contain research guides (shown in the Research Guides view).
  research_guide_groups: [10729]

  # Valid department values shown in the stewardship assignment dropdowns.
  departments:
    - "Archives"
    - "ACS"
    - "CLOPS"
    - "DLD"
    - "LIT"
    - "RS"
```

**What you might need to change here:**
- `stale_days` / `very_stale_days` — adjust staleness thresholds to your policy.
- `website_page_groups` / `research_guide_groups` — update if LibGuides group IDs change.
- `departments` — add or remove departments as the organisation changes.

### proxy

Runtime configuration for the Deno backend proxy.

```yaml
proxy:
  port: 8080               # Port the Deno proxy listens on.
                           # Change if 8080 is taken. Must match Apache ProxyPass rules.
  libguides:
    base_url: "https://lgapi-us.libapps.com/1.2"
    token_url: "https://lgapi-us.libapps.com/1.2/oauth/token"
    client_id: "${LIBGUIDES_CLIENT_ID}"      # Never hardcode — set via environment variable.
    client_secret: "${LIBGUIDES_CLIENT_SECRET}"
  cache:
    enabled: true
    ttl_seconds: 3600      # How long the proxy caches LibGuides API responses (seconds).
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LIBGUIDES_CLIENT_ID` | Production | OAuth client ID from Springshare |
| `LIBGUIDES_CLIENT_SECRET` | Production | OAuth client secret from Springshare |
| `DEV_USER` | Development only | Identity returned by `/api/whoami` when Shibboleth is absent (e.g. your email). Defaults to `dev-user` if unset. |

---

## Development setup

### 1. Initialise the dataset collections

Run once, from the repository root:

```shell
dataset init stewardship.ds sqlite://collection.db
dataset init audit.ds sqlite://collection.db
```

### 2. Load seed stewardship data

If `stewardship.jsonl` exists (generated from the original `stewardship.json`):

```shell
dataset load stewardship.ds < stewardship.jsonl
```

To regenerate `stewardship.jsonl` from `stewardship.json`:

```shell
jq -c 'to_entries[] | {key: .key, object: .value}' stewardship.json > stewardship.jsonl
```

### 3. Create htdocs/dev-config.js

This file tells the browser where to find each service in development. It is
**gitignored** and must never be committed.

Create the file at `htdocs/dev-config.js`:

```javascript
// htdocs/dev-config.js — development only, gitignored
window.__DEV_CONFIG__ = {
  apiBase:     'http://localhost:8080',  // Deno proxy (LibGuides, whoami, config)
  datasetBase: 'http://localhost:8200',  // datasetd (stewardship, audit CRUD)
};
```

If both ports match the defaults in `content_dashboard.yaml` you do not need to
change anything. If you changed `host:` or `proxy.port:` in the YAML, update the
URLs here to match.

In production this file is absent. The browser falls back to relative paths
(`/content-dashboard/api/...`) which Apache routes to the correct service.

### 4. Start datasetd

```shell
datasetd content_dashboard.yaml
```

datasetd will serve static files from `htdocs/` at `http://localhost:8200/` and
expose the dataset JSON API at `http://localhost:8200/api/`.

### 5. Start the Deno proxy

```shell
# With real LibGuides credentials:
LIBGUIDES_CLIENT_ID=your_id LIBGUIDES_CLIENT_SECRET=your_secret deno task proxy

# Without credentials (LibGuides calls will fail, but stewardship/audit work):
DEV_USER=yourname@caltech.edu deno task proxy-dev
```

### 6. Open the application

```
http://localhost:8200/
```

The browser loads `htdocs/dev-config.js`, which points API calls to the correct
services at `:8200` and `:8080`.

---

## Production setup

### Environment variables for systemd services

Set credentials in the systemd unit files (see `dev-notes/MIGRATION_PLAN.md` for
full unit file examples) or in a `/etc/default/content-dashboard` environment file
sourced by each unit.

Do **not** put `DEV_USER` in production — it is only meaningful when Shibboleth
headers are absent.

### Apache reverse proxy rules

Add the following inside the existing `<VirtualHost *:443>` block for
`apps.library.caltech.edu`. More specific paths must appear before the general
datasetd catch-all:

```apache
# Redirect bare path to trailing-slash form
Redirect /content-dashboard /content-dashboard/

# Deno proxy — LibGuides passthrough and identity endpoints
ProxyPass        "/content-dashboard/api/libguides/" "http://localhost:8080/api/libguides/" retry=0
ProxyPassReverse "/content-dashboard/api/libguides/" "http://localhost:8080/api/libguides/"
ProxyPass        "/content-dashboard/api/whoami"     "http://localhost:8080/api/whoami"     retry=0
ProxyPassReverse "/content-dashboard/api/whoami"     "http://localhost:8080/api/whoami"
ProxyPass        "/content-dashboard/api/config"     "http://localhost:8080/api/config"     retry=0
ProxyPassReverse "/content-dashboard/api/config"     "http://localhost:8080/api/config"

# datasetd — static files and dataset JSON API
ProxyPass        "/content-dashboard/"  "http://localhost:8200/" retry=0
ProxyPassReverse "/content-dashboard/"  "http://localhost:8200/"

# Shibboleth protection for the entire application
<Location /content-dashboard/>
    AuthType shibboleth
    ShibRequestSetting requireSession 1
    require valid-user
    # Forward authenticated identity to the Deno proxy for updatedBy tracking
    RequestHeader set Remote-User "%{REMOTE_USER}e"
</Location>
```

### Port reference

| Service | Default port | Configuration key |
|---------|-------------|-------------------|
| datasetd | 8200 | `host:` in `content_dashboard.yaml` |
| Deno proxy | 8080 | `proxy.port:` in `content_dashboard.yaml` |

If you change either port, update **both** `content_dashboard.yaml` and the
Apache `ProxyPass` rules.

---

## Verifying the deployment

Once both services are running and Apache is configured:

1. Browse to `https://apps.library.caltech.edu/content-dashboard/`
2. Authenticate via Shibboleth when prompted
3. Open browser DevTools → Network tab
4. Confirm `GET /content-dashboard/api/config` returns a JSON object with the
   `browser_config` values from `content_dashboard.yaml`
5. Confirm `GET /content-dashboard/api/whoami` returns `{ "user": "yourname@caltech.edu" }`
   (your Caltech email, not `"dev-user"`)
6. Confirm the stewardship and audit views load data

If `whoami` returns `"dev-user"` in production, check that the `RequestHeader set
Remote-User` directive is inside the `<Location>` block and that Shibboleth is
active for that path.

---

## Further reading

- `dev-notes/MIGRATION_PLAN.md` — full architecture, systemd unit files, data migration
- `dev-notes/STRUCTURAL_ANALYSIS.md` — service inventory and API endpoint map
- `dev-notes/IMPLEMENTATION_ANALYSIS.md` — detailed description of every code change
