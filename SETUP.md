# Content Dashboard: Setup Guide

This document covers configuration and setup for operators and developers. It assumes the
repository is already cloned and that the required software (listed below) is installed.

## Architecture summary

Two services run in production, behind a single Apache virtual host with Shibboleth
authentication. The router is the only browser-facing service; datasetd is internal-only:

```
Browser → Apache + Shibboleth (apps.library.caltech.edu)
              │
              └─ /content-dashboard/  →  router  :8201
                                          ├─ /api/{config,whoami,health}  (native)
                                          ├─ /lg/api/*  →  LibGuides API (proxied)
                                          ├─ /ds/api/*  →  datasetd :8200 (proxied, internal-only)
                                          └─ everything else → htdocs/ static files
```

In development, Apache and Shibboleth are not involved. The browser speaks directly to
the router on `http://localhost:8201/`, which still proxies `/ds/api/*` to datasetd on
`http://localhost:8200/`.

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
| `datasetd` | 2.4.1 | Data service (internal, JSON API only) |
| `dataset` | 2.4.1 | CLI for initialising and loading collections |
| Deno | 2.8 | Runs the router service |
| SQLite | 3.38 | Storage engine used by datasetd (`->>` operator required) |

---

## Configuration files: content_dashboard.yaml and api_router.yaml

Service configuration is split across two files at the repository root:

- `content_dashboard.yaml` — read by `datasetd`. Its YAML decoder is strict
  (unknown top-level keys are a fatal error), so this file may only contain
  `host`, `htdocs`, `schemas`, and `collections`.
- `api_router.yaml` — read by the router. Holds `browser_config` and
  `router` settings (including the `dataset.base_url` used to reach datasetd).

Do not commit credentials — supply them via environment variables (see below).

### Top-level server settings

```yaml
host: localhost:8200   # Address datasetd listens on. Internal-only; not
                       # exposed to the browser or Apache.
                       # Change the port if 8200 is taken on your machine,
                       # and update router.dataset.base_url to match.

htdocs: htdocs         # Path to the browser-served directory, relative to this file.
                       # Unused now that the router serves htdocs/ directly,
                       # but left as-is for compatibility.
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

These values are served to the browser at `GET /api/config` by the router.
They replace the old `htdocs/config.js` file. They live in `api_router.yaml`,
not `content_dashboard.yaml`.

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

### router

Runtime configuration for the Deno router. This section also lives in
`api_router.yaml`.

```yaml
router:
  port: 8201               # Port the router listens on.
                           # Change if 8201 is taken. Must match the Apache ProxyPass rule.
  dataset:
    base_url: "http://localhost:8200"  # Where datasetd listens. The router
                                        # proxies /ds/api/* here.
  libguides:
    base_url: "https://lgapi-us.libapps.com/1.2"
    token_url: "https://lgapi-us.libapps.com/1.2/oauth/token"
    client_id: "${LIBGUIDES_CLIENT_ID}"      # Never hardcode — set via environment variable.
    client_secret: "${LIBGUIDES_CLIENT_SECRET}"
  cache:
    enabled: true
    ttl_seconds: 3600      # How long the router caches LibGuides API responses (seconds).
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

### 3. Start datasetd

```shell
datasetd content_dashboard.yaml
```

datasetd listens on `http://localhost:8200/` and exposes the dataset JSON API at
`http://localhost:8200/api/`. It is internal-only — the router proxies to it.

### 4. Start the router

```shell
# With real LibGuides credentials:
LIBGUIDES_CLIENT_ID=your_id LIBGUIDES_CLIENT_SECRET=your_secret deno task router

# Without credentials (LibGuides calls will fail, but stewardship/audit work):
deno task router-dev
```

`router-dev` sets `DEV_USER=dev-user` so `/api/whoami` returns a usable identity
without Shibboleth. To use your own identity instead:

```shell
DEV_USER=yourname@caltech.edu deno run --allow-net --allow-env --allow-read --env-file=.env router/main.ts api_router.yaml
```

### 5. Open the application

```
http://localhost:8201/
```

The router serves `htdocs/` directly and handles `/api/*`, `/lg/api/*`, and
`/ds/api/*` (proxied to datasetd on `:8200`).

### Building the browser client modules

`htdocs/modules/lg-client.js` and `htdocs/modules/ds-client.js` are compiled from
`lg-client.ts` and `ds-client.ts` and are checked into the repository. If you change
either `.ts` source file, rebuild them with:

```shell
deno task htdocs
```

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
`apps.library.caltech.edu`. See `etc/content-dashboard.conf-example` for the
full, current example:

```apache
ProxyPreserveHost On

# Redirect bare path to trailing-slash form
Redirect "/content-dashboard" "/content-dashboard/"

# --- content-dashboard-router (:8201) ---
# Serves htdocs/ static files, /api/* (config, whoami, health),
# /lg/api/* (proxied LibGuides), and /ds/api/* (proxied to datasetd :8200,
# internal-only).
ProxyPass        "/content-dashboard/" "http://localhost:8201/" retry=0
ProxyPassReverse "/content-dashboard/" "http://localhost:8201/"

<Location /content-dashboard/>
    AuthType shibboleth
    ShibRequestSetting requireSession 1
    require valid-user
    # Forward authenticated identity to the router for updatedBy tracking
    RequestHeader set Remote-User "%{REMOTE_USER}e"
</Location>
```

### Port reference

| Service | Default port | Configuration key |
|---------|-------------|-------------------|
| router | 8201 | `router.port:` in `api_router.yaml` |
| datasetd | 8200 | `host:` in `content_dashboard.yaml`, `router.dataset.base_url:` in `api_router.yaml` |

datasetd is internal-only; only the router's port needs an Apache `ProxyPass` rule.
If you change either port, update the relevant YAML file(s) and, for the router's
port, the Apache `ProxyPass` rule.

---

## Verifying the deployment

Once both services are running and Apache is configured:

1. Browse to `https://apps.library.caltech.edu/content-dashboard/`
2. Authenticate via Shibboleth when prompted
3. Open browser DevTools → Network tab
4. Confirm `GET /content-dashboard/api/config` returns a JSON object with the
   `browser_config` values from `api_router.yaml`
5. Confirm `GET /content-dashboard/api/whoami` returns `{ "user": "yourname@caltech.edu" }`
   (your Caltech email, not `"dev-user"`)
6. Confirm the stewardship and audit views load data (via `/ds/api/...`, proxied
   to datasetd)
7. Confirm the Website Pages and Research Guides views populate (via `/lg/api/guides`)

If `whoami` returns `"dev-user"` in production, check that the `RequestHeader set
Remote-User` directive is inside the `<Location>` block and that Shibboleth is
active for that path.

---

## Further reading

- `dev-notes/MIGRATION_PLAN.md` — full architecture, systemd unit files, data migration
- `dev-notes/STRUCTURAL_ANALYSIS.md` — service inventory and API endpoint map
- `dev-notes/IMPLEMENTATION_ANALYSIS.md` — detailed description of every code change
