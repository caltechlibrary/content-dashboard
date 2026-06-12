// lg-client.ts / htdocs/modules/lg-client.js
//
// Browser-side client for the router's /lg/api/* endpoints (proxied
// LibGuides). Paths are document-relative so this works whether the page
// is served at http://localhost:8201/ (dev) or
// https://apps.library.caltech.edu/content-dashboard/ (prod).

export interface Account {
  id: number;
  first_name: string;
  last_name: string;
}

export interface Page {
  id: number;
  label?: string;
  name?: string;
  friendly_url?: string;
  url?: string;
  redirect_url?: string;
  updated?: string;
  enable_display?: number;
  owner?: Account;
}

export interface Guide {
  id: number;
  title?: string;
  name?: string;
  friendly_url?: string;
  url?: string;
  group_id?: number | string;
  updated?: string;
  owner?: Account;
  pages?: Page[];
}

export interface GuideQuery {
  status?: 0 | 1;
  expand?: string;
}

export async function getAccounts(): Promise<Account[]> {
  const res = await fetch("lg/api/accounts");
  if (!res.ok) throw new Error(`accounts fetch failed: ${res.status}`);
  return await res.json();
}

export async function getGuides(query: GuideQuery = {}): Promise<Guide[]> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set("status", String(query.status));
  if (query.expand) params.set("expand", query.expand);
  const qs = params.toString();
  const res = await fetch(`lg/api/guides${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`guides fetch failed: ${res.status}`);
  return await res.json();
}
