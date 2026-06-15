
# Deploying Content Dashboard

Content Dashboard is implemented as a Dataset web application and a Deno+TypeScript based router/API gateway that serves the browser app, proxies the LibGuides API, and proxies the dataset JSON API. Access to LibGuides is handled through a `.env` file in the root directory the application. Two variables need to be set, LIBGUIDES_CLIENT_ID and LIBGUIDES_CLIENT_SECRET. The values for this are found in the LibGuides Tools -> API -> Authentication page. The `.env` file should never be checked into the Git repository.

The application is designed to run as a systemd service on Ubuntu Server 24.04 LTS (or more recent release). The executable for the router needs to be compiled and in the `bin` directory based on the systemd service definision found in the `etc` directory.

## Initial Deploying steps

1. SSH to our production machine
2. Change directories to `/Sites`
3. Clone the GitHub repository `git@github.com:caltechlibrary/content-dashboard`
4. Change into the `content-dashboard` directory
5. Make sure Dataset, Deno and other software is installed and up to date (`bash check_software.bash` 
6. Compile the app `make`
7. Make sure datasetd is available and the right version
8. Create the `.env` file that exports the LIBGUIDES_CLIENT_ID and LIBGUIDES_CLIENT_SECRET environment variables
9. Add the etc/content-dashboard.service and etc/content-dashboard-api.service services to the production machine's systemd setup
10. Update the Apache2 configure per the example in etc/content-dashboard.conf-example
11. Start the service, restart apache and debug

## Updating Deploying steps

1. SSH to our production machine
2. cd /Sites/content-dashboard
3. Stop the content dashboard services using `systemctl`
4. Make sure Dataset, Deno and other software is installed and up to date (`bash check_software.bash` 
5. Run `git fetch origin; git pull origin main`
6. Run `make`
7. Run `make test`
8. If tests pass then restart the systemd services otherwise debug issues

## Notes

- The browser app uses document-relative paths (`api/...`, `lg/api/...`, `ds/api/...`),
  so no per-environment configuration file is needed. In production, Apache proxies
  `/content-dashboard/` to the router on `:8200`, which serves `htdocs/` directly and
  proxies `/lg/api/*` and `/ds/api/*` per `etc/content-dashboard.conf-example`.

## Troubleshooting

Start with `journalctl -u content-dashboard.service -u content-dashboard-api.service`.

### `status=203/EXEC`, "Start request repeated too quickly"

systemd could not execve `bin/content-dashboard`. This almost always means
`make` was not (re)run on production after `git pull`, so the binary is
missing or stale. Run `make` in `/Sites/content-dashboard`, confirm
`bin/content-dashboard` exists and is executable, then
`sudo systemctl restart content-dashboard.service`.

### "Ignoring invalid environment assignment 'export LIBGUIDES_CLIENT_ID=...'"
### Router logs "LIBGUIDES_CLIENT_ID/LIBGUIDES_CLIENT_SECRET are empty"

systemd's `EnvironmentFile=` does **not** support shell `export` syntax.
`export FOO=bar` is parsed as a variable named `export FOO` (contains a
space, which is invalid), so the whole line is silently dropped — the
service starts, but `/lg/api/*` will fail. `.env` must contain bare
assignments:

```
LIBGUIDES_CLIENT_ID="1043"
LIBGUIDES_CLIENT_SECRET="..."
```

(Quotes are fine on Ubuntu 24.04 / systemd >= 246.) After editing `.env`,
run `sudo systemctl restart content-dashboard.service`.

### Static files (`/content-dashboard/modules/*.js`) load, but
### `/content-dashboard/api/*` returns 403

This means Apache is proxying `/content-dashboard/` to the wrong port —
most likely `datasetd` (`:8201`) instead of the router (`:8200`). datasetd
also serves `htdocs/` (its own `htdocs:` key in `content_dashboard_api.yaml`),
so static assets succeed, but it has no `/api/config`, `/api/whoami`, etc.
routes and returns 403 for them.

Confirm by hitting the router directly on the production host, bypassing
Apache:

```bash
curl -i http://127.0.0.1:8200/api/config
```

If that returns `200`, the app is fine and the **deployed** Apache vhost
(`/etc/apache2/sites-enabled/apps.library.caltech.edu.conf` — a different
file from `etc/content-dashboard.conf-example`) has a stale
`ProxyPassMatch`/`ProxyPassReverse` target. Update it to match
`etc/content-dashboard.conf-example` (router on `:8200`, datasetd on
`:8201` internal-only) and reload:

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Note: the router's `:8200` / datasetd's `:8201` port assignment was
swapped during the 2026-06-15 production update. Any Apache config
deployed before that change will need this fix.
