
# Deploying Content Dashboard

Content Dashboard is implemented as a Dataset web application and a Deno+TypeScript based proxy to allow accessing the LibGuides API. Access to LibGuides is handled through a `.env` file in the root directory the application. Two variables need to be set, LIBGUIDES_CLIENT_ID and LIBGUIDES_CLIENT_SECRET. The values for this are found in the LibGuides Tools -> API -> Authentication page. The `.env` file should never be checked into the Git repository.

The application is designed to run as a systemd service on Ubuntu Server 24.04 LTS (or more recent release). The executable for the proxy server needs to be compiled and in the `bin` directory based on the systemd service definision found in the `etc` directory.

## Initial Deploying steps

1. SSH to our production machine
2. Change directories to `/Sites`
3. Clone the GitHub repository `git@github.com:caltechlibrary/content-dashboard`
4. Change into the `content-dashboard` directory
5. Make sure Dataset, Deno and other software is installed and up to date (`bash check_software.bash` 
6. Compile the app `make`
7. Make sure datasetd is available and the right version
8. Create the `.env` file that exports the LIBGUIDES_CLIENT_ID and LIBGUIDES_CLIENT_SECRET environment variables
9. Add the etc/content-dashboard-proxy.service and etc/content-dashboard-api.service services to the production machine's systemd setup
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

- `htdocs/dev-config.js` is a development-only file (gitignored, see `htdocs/dev-config.js.example`
  and SETUP.md). It is never created on the production machine. `htdocs/index.html` loads it with
  an `onerror` fallback, so the browser falls back to relative paths
  (`/content-dashboard/api/...`), which Apache routes to the proxy and datasetd per
  `etc/content-dashboard.conf-example`.
