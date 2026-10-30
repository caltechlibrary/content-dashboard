# 005. Confluence spaces have a coordinator, not an owner

- **Status:** Accepted
- **Date:** October 2026
- **Decided by:** Intranet Working Group

## Context

The Confluence view (decision 004) assigns one person to each space. Most
spaces belong to a department, a committee, or a working group, so the
natural person to assign is the department head or committee chair. The
first version of the view called this person the space's **owner**.

But spaces are large, often hundreds of pages, and the department head or
chair isn't the one who should update all of them. Calling them the
"owner" suggests they're responsible for doing the work. What the audit
needs is someone to make sure the work gets done.

## Decision

The person assigned to a Confluence space is its **coordinator**.

- The coordinator makes sure the space gets reviewed and updated during
  the audit period. They don't have to do the updates themselves.
- By default, the coordinator is the head of the department, or the chair
  of the committee or working group, that the space belongs to.
- The column in the Confluence view is labeled **Coordinator**.
- This only applies to Confluence. The LibGuides views keep their
  existing terms.

## Options considered

1. **Owner.** This was the first label. It's short and familiar, but it
   suggests the person does the work, which isn't fair for large spaces.
2. **Coordinator.** *Chosen.* It says what the role actually is.

## Consequences

- The role is clearer to the people assigned, and it's easier to ask a
  department head or chair to take it on.
- The stored field in `confluence.ds` is still called `owner`. Renaming
  it would mean changing records already saved, and the name isn't shown
  to anyone, so it stays. Anyone reading the code should know that
  `owner` means coordinator in the Confluence view.
- A few labels in the view still say "owner": the summary line and the
  screen reader labels on the dropdown and filter box. These should be
  updated to "coordinator" to match.
