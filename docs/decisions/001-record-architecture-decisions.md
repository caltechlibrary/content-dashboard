# 001. Record architecture decisions

- **Status:** Accepted
- **Date:** Oct 2026s
- **Decided by:** Twila Smith

## Context

Content Dashboard has been built in stages. It started as a Cloudflare Workers app, 
was rebuilt on datasetd and a Deno router to run on Caltech's own servers, 
and is now picking up new views like Confluence.

The code shows *what* was built, but not *why*. When something looks odd,
there's no record of whether it was a deliberate choice, a constraint we
had to work around, or a leftover from an earlier version. That makes it
slow to change things with confidence, and easy to undo a decision
without knowing it was one.

## Decision

We will keep decision records in `docs/decisions/`.

- One decision per file, numbered in order: `001-short-title.md`,
  `002-short-title.md`, and so on.
- Each one covers the context, the decision, the options we weighed, and
  what follows from it.
- Write one when a choice would be hard to reverse, affects how the app
  is deployed or where its data comes from, or is the kind of thing
  someone would later ask "why did we do it this way?"
- Decision records aren't edited after they're accepted, except to fix
  mistakes or update the status. If a decision changes, write a new one
  and mark the old one **Superseded by** the new one.

Status is one of: **Proposed**, **Accepted**, **Superseded**, or
**Deprecated**.

## Consequences

- Decisions and their reasons live next to the code, so they move with
  the repository and show up in its history.
- Writing one takes a little time at the moment of deciding.
