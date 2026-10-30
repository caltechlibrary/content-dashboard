# 002. Build the Content Dashboard

- **Status:** Accepted
- **Date:** May 2026
- **Decided by:** Twila Smith

## Context

The library uses LibGuides as its main website, not just for research
guides. Pages are split into two kinds by LibGuides group: research
guides, and website pages. The group decides which template a page uses.
(The group IDs are in `content_dashboard.yaml`.)

Website pages are gathered into guides by theme. But different people in
the library may be responsible for different pages within the same
website guide, and LibGuides only tracks ownership at the guide level.
There was no way to record who was responsible for an individual page.

The workaround was a hidden box on each guide noting who was responsible
for its pages. In practice most pages were never assigned, and there was
no set time to review them, so pages went out of date and links broke
without anyone noticing.

The Website Committee started **Junk-It July**, a yearly push for staff to
look over their assigned pages for accuracy and broken links. That only
works if every page has someone assigned to it, and if there's a way to
see what's been checked.

## Decision

Build the Content Dashboard, a separate app that sits alongside LibGuides
and tracks what LibGuides doesn't:

- **Page-level responsibility:** each website page can be assigned to a
  department and a person. The leadership team assigns pages to
  departments, and each department head assigns their department's pages
  to individuals.
- **Audit tracking:** checkboxes for links, accessibility, and accuracy on
  each page and guide, so review progress is visible.
- **Reports:** stale, hidden, and unpublished pages and guides, to help
  decide where to focus during cleanup.

The app reads guides, pages, and staff names from the LibGuides API, and
keeps assignments and audit results in its own storage.

Since then, the dashboard has also taken on Confluence spaces, in
partnership with the Intranet Working Group (decision 004). It has become
the library's central hub for content accuracy and management.

## Options considered

1. **Keep the hidden box on each guide.** It was already in place, but it
   wasn't kept up, couldn't be searched or reported on, and had no way to
   record whether a page had been reviewed.
2. **A shared spreadsheet.** Easy to start, but the list of pages would
   have to be copied in and kept up to date by hand. New pages wouldn't
   show up until someone added them.
3. **A Confluence database page.** Same problem as a spreadsheet: the page
   list would be maintained by hand, separate from LibGuides.
4. **A separate dashboard.** *Chosen.* It reads the page list straight
   from the LibGuides API, so new pages show up on their own and nothing has to be
   copied by hand.

## Consequences

- Every website page can have a named person responsible for it, and
  review progress for Junk-It July can be seen in one place.
- Assignments live in the dashboard, not in LibGuides. Someone editing a
  page in LibGuides won't see who's assigned to it unless they check the
  dashboard.
- The dashboard depends on the LibGuides API. That API doesn't expose
  everything, for example the content of boxes on a page, so some things
  can't be checked automatically.
- It's another app to host and maintain. It runs on the library's apps
  server (see DEPLOYMENT.md).
