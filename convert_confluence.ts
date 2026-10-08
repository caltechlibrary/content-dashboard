// convert_confluence.ts
//
// Turns a Confluence "Spaces report" CSV export into confluence.jsonl,
// ready for `dataset load confluence.ds`.
//
// There is no Confluence API available to us, so this export is the only
// source for the space list. Re-run this whenever a fresh export is pulled.
//
// Usage:
//   deno task convert-confluence "/path/to/Spaces report - ....csv"
//
// What gets kept:
//   - only spaces whose status is CURRENT (archived and trashed are dropped)
//   - only personal spaces are dropped too — their keys start with "~" and
//     the space name is just the person's name, so there is no owner to assign
//   - four columns: Space Key, Space Name, Last Viewed, Content Count
//
// The space key becomes the record key. Keys are unique in the export.

import { parse } from "jsr:@std/csv/parse";

const SPACE_KEY = "Space Key";
const SPACE_NAME = "Space Name";
const SPACE_STATUS = "SpaceStatus";
const LAST_VIEWED = "Last Viewed";
const CONTENT_COUNT = "Content Count";

const REQUIRED_COLUMNS = [
  SPACE_KEY,
  SPACE_NAME,
  SPACE_STATUS,
  LAST_VIEWED,
  CONTENT_COUNT,
];

export interface SpaceRecord {
  spaceKey: string;
  spaceName: string;
  lastViewed: string;
  contentCount: number;
  owner: string;
}

export function convert(csvText: string): { key: string; object: SpaceRecord }[] {
  const rows = parse(csvText, { skipFirstRow: true }) as Record<string, string>[];

  if (rows.length > 0) {
    const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
    if (missing.length > 0) {
      throw new Error(
        `export is missing expected column(s): ${missing.join(", ")}`,
      );
    }
  }

  return rows
    .filter((r) => (r[SPACE_STATUS] ?? "").trim().toUpperCase() === "CURRENT")
    .filter((r) => !(r[SPACE_KEY] ?? "").startsWith("~"))
    .map((r) => {
      const key = (r[SPACE_KEY] ?? "").trim();
      return {
        key,
        object: {
          spaceKey: key,
          spaceName: (r[SPACE_NAME] ?? "").trim(),
          // Blank for spaces nobody has opened in the reporting window.
          // The view shows these as "never" rather than an empty cell.
          lastViewed: (r[LAST_VIEWED] ?? "").trim(),
          contentCount: Number((r[CONTENT_COUNT] ?? "").trim()) || 0,
          // Filled in from the dashboard, not from the export.
          owner: "",
        },
      };
    })
    .filter((entry) => entry.key !== "");
}

if (import.meta.main) {
  const src = Deno.args[0];
  if (!src) {
    console.error(
      'usage: deno task convert-confluence "/path/to/Spaces report.csv"',
    );
    Deno.exit(1);
  }

  const entries = convert(await Deno.readTextFile(src));
  const out = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await Deno.writeTextFile("confluence.jsonl", out);

  console.log(`Wrote confluence.jsonl from ${src}`);
  console.log(`Spaces kept: ${entries.length}`);
}
