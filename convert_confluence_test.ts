import { assertEquals } from "jsr:@std/assert";
import { convert } from "./convert_confluence.ts";

const HEADER =
  "Space Id,Space Key,Space Name,Space Type,SpaceStatus,Creation Date," +
  "Creator Account Id,Creator Full Name,Public Link Perm,Public Link Count," +
  "Anonymous Access Status,Last Viewed,Content Count,Attachments,Storage used (MB)";

function row(key: string, name: string, status: string, viewed: string, count: string) {
  return `1,${key},${name},global,${status},2020-01-01,acct,Someone,,0,,${viewed},${count},0,0`;
}

Deno.test("keeps only CURRENT spaces", () => {
  const csv = [
    HEADER,
    row("DLD", "Digital Library Development", "CURRENT", "2026-09-16", "199"),
    row("OLD", "Retired Space", "ARCHIVED", "2024-01-01", "5"),
    row("GONE", "Deleted Space", "TRASHED", "", "0"),
  ].join("\n");

  const out = convert(csv);
  assertEquals(out.length, 1);
  assertEquals(out[0].key, "DLD");
  assertEquals(out[0].object.spaceName, "Digital Library Development");
  assertEquals(out[0].object.contentCount, 199);
  // Owners are assigned in the dashboard, never imported
  assertEquals(out[0].object.owner, "");
});

Deno.test("drops personal spaces", () => {
  const csv = [
    HEADER,
    row("~someone", "A Person", "CURRENT", "2026-05-15", "2"),
    row("LIT", "Library Information Technology", "CURRENT", "2026-09-11", "41"),
  ].join("\n");

  assertEquals(convert(csv).map((e) => e.key), ["LIT"]);
});

Deno.test("a blank Last Viewed stays blank, and a blank count reads as zero", () => {
  const csv = [HEADER, row("LD", "LIT DEV", "CURRENT", "", "")].join("\n");
  const out = convert(csv);
  assertEquals(out[0].object.lastViewed, "");
  assertEquals(out[0].object.contentCount, 0);
});

Deno.test("quoted space names survive the comma", () => {
  const csv = [
    HEADER,
    '1,BOC,"Business, Operations",global,CURRENT,2020-01-01,acct,Someone,,0,,2026-09-11,8,0,0',
  ].join("\n");
  assertEquals(convert(csv)[0].object.spaceName, "Business, Operations");
});

Deno.test("an export missing a column we need fails loudly", () => {
  const csv = ["Space Key,Space Name\nDLD,Digital Library Development"].join("\n");
  let msg = "";
  try { convert(csv); } catch (err) { msg = (err as Error).message; }
  assertEquals(msg.includes("missing expected column"), true);
});
