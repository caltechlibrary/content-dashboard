// confluence-client.ts / htdocs/modules/confluence-client.js
//
// Browser-side client for the router's /cf/api/* endpoints (Confluence,
// read through the router so the API token never reaches the browser).
// Paths are document-relative so this works whether the page is served at
// http://localhost:8200/ (dev) or
// https://apps.library.caltech.edu/content-dashboard/ (prod).

export interface Space {
  spaceKey: string;
  spaceName: string;
  url: string;
  pageCount: number | null;
}

export async function getSpaces(): Promise<Space[]> {
  const res = await fetch("cf/api/spaces");
  if (!res.ok) throw new Error(`confluence spaces fetch failed: ${res.status}`);
  return await res.json();
}
