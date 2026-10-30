# 003. Move from Cloudflare to Dataset on the library's apps server

- **Status:** Accepted
- **Date:** May 2026
- **Decided by:** Tom Morrel, Twila Smith

## Context

The first version of the dashboard was built on Cloudflare Workers, with
Cloudflare's KV store for data. Workers made it fast to get a proof of
concept up and working, which was the goal at the time.

After the proof of concept was presented, the decision was made to put
it into production. That meant moving it off Cloudflare and onto the
library's own infrastructure, where it could be supported long term. 
The prototype also had no login in front of it.

The dashboard holds no sensitive personal information. The only personal
data is staff names, which are already public in the staff directory.
But it's an internal tool for staff, and it can change assignments and
audit records, so it should only be reachable by people who log in.

## Decision

Rebuild the dashboard on **Dataset**, an application developed by our
colleague Robert Doil, and host it on the library's internally hosted
applications server (`apps.library.caltech.edu`) behind **Shibboleth**.

Robert Doil set up:

- **datasetd**, Dataset's web service, which stores the stewardship,
  audit, and Confluence records and provides the API the dashboard
  reads and writes through.
- **A Deno router**, the only part the browser talks to. It serves the
  dashboard's pages, holds the LibGuides credentials (and now the
  Confluence token) so they never reach the browser, and passes data
  requests on to datasetd.
- **The Dataset collections** that define the shape of each kind of record.

Apache sits in front of the router and requires a Shibboleth login before
anything is served.

## Options considered

1. **Stay on Cloudflare Workers.** Fast to work with, and already
   built. But it would live outside the library's infrastructure, with
   no Caltech login in front of it.
2. **Dataset on the library's apps server.** *Chosen.* It runs where the
   library's other applications run, uses Caltech's login, and builds on
   a tool a colleague already maintains.

## Consequences

- Only staff who log in with their Caltech account can reach the
  dashboard.
- The data lives on the library's own server (in SQLite, through
  datasetd), not in a third-party service.
- The dashboard depends on Dataset. Knowledge of how it's built is
  shared between Twila and Robert, so changes to the data layer may
  need Robert's help.
- Deploying takes more steps than it did on Cloudflare. Changes are
  pulled from Git, and the router is compiled on the server (see
  DEPLOYMENT.md).
- The Cloudflare version was fully retired in June 2026.
