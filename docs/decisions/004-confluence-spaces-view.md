# 004. Add a Confluence Spaces view, fed by the Confluence API

- **Status:** Accepted
- **Date:** September 2026
- **Decided by:** Intranet Working Group

## Context

Confluence is the library's internal documentation site, and nobody is in
charge of making sure its content is accurate. When the Intranet Working
Group formed, it became clear how out of date the staff intranet and
documentation had become.

Along with a cleanup (deleting and archiving old content), the working
group proposed an annual audit period, in collaboration with the Website
Committee. To make that work, each space needs someone assigned to
coordinate getting it updated.

The dashboard already tracks LibGuides responsibility and audits at the
page level. Springshare only tracks at the guide level, which is why the
dashboard exists. Putting Confluence spaces in the same app means one
place for staff to see what they're responsible for, and audits are
tracked the same way for both.

## Decision

Add a **Confluence Spaces** view to the dashboard.

- **Space list:** comes live from the Confluence Cloud REST API. The
  router reads it (`/cf/api/spaces`) so the API token never reaches the
  browser.
- **Which spaces:** current spaces only. Personal spaces are left out,
  since they aren't widely used and already belong to one person.
- **Columns:** space name (linked to the space), coordinator, page count,
  and the three audit checks.
- **Page count:** pages only, counted with a Confluence search for each
  space.
- **Coordinators:** one person per space, picked from the LibGuides staff
  list (the same list the other views use) and stored in `confluence.ds`.
  What the role means is covered in decision 005.
- **Audit checks:** stored in the existing `audit.ds`, under the type
  `space`.
- **Authentication:** a personal Atlassian API token (email + token in
  `.env`).

## Options considered

**Where the space list comes from**

1. **Confluence "Spaces report" CSV export.** This was the first version,
   built when we didn't have API access. It worked, but someone had to
   export and reload the CSV by hand, and it went out of date between
   exports. Re-loading didn't update spaces already loaded, and it didn't
   remove spaces that had been archived.
2. **Confluence API with a personal token.** *Chosen.* The data is always
   current and there's nothing to load by hand. The cost is a token that
   has to be renewed.
3. **Confluence API with a service account or OAuth app.** This would not
   depend on one person's account. It needs an Atlassian admin to set up,
   and an OAuth app is a lot more work to build. Worth coming back to.
4. **A Forge app inside Confluence.** No token to manage, but it's a
   different platform from the rest of the dashboard.

**Last viewed column**

The CSV export included a "last viewed" date, and the first version
showed it. The team voted to drop it because, after the cleanup, every 
space was current and recently viewed. From now on the audit makes sure 
every space is reviewed on a regular schedule, so unused spaces will be 
caught that way.  The API doesn't provide it anyway, so it was removed 
along with the CSV.

## Consequences

- Space names and page counts are always current. A renamed space shows
  its new name with no extra step.
- **The token expires within a year.** Someone has to make a new one and
  update `.env` on the server before it does. DEPLOYMENT.md covers how.
- **The token belongs to one person's account.** The view only sees the
  spaces that person can see, and it stops working if their account goes
  away.
- Page counts take one request per space. The router caches the list for
  5 minutes, so a change in Confluence can take that long to show up.
- Page counts are pages only, so they don't match the old CSV's "content
  count", which may have counted other kinds of content too.
- `confluence.ds` only holds coordinators. A space gets a record the first
  time someone assigns it a coordinator.
