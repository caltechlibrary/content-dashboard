// ds-client.ts / htdocs/modules/ds-client.js
//
// Browser-side client for the router's /ds/api/* endpoints (proxied
// datasetd). Paths are document-relative so this works whether the page
// is served at http://localhost:8201/ (dev) or
// https://apps.library.caltech.edu/content-dashboard/ (prod).

export async function getKeys(collection: string): Promise<string[]> {
  const res = await fetch(`ds/api/${collection}/keys`);
  if (!res.ok) {
    throw new Error(`${collection} keys fetch failed: ${res.status}`);
  }
  return await res.json();
}

export async function getObject<T = Record<string, unknown>>(
  collection: string,
  key: string,
): Promise<T> {
  const res = await fetch(`ds/api/${collection}/object/${encodeURIComponent(key)}`);
  if (!res.ok) {
    throw new Error(`${collection} object "${key}" fetch failed: ${res.status}`);
  }
  return await res.json();
}

export async function putObject(
  collection: string,
  key: string,
  data: unknown,
): Promise<Response> {
  return await fetch(`ds/api/${collection}/object/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// Fetches every object in a collection, keyed by its key. Keys whose
// object fetch fails are silently skipped (matches prior app.js behavior).
export async function getAllObjects<T = Record<string, unknown>>(
  collection: string,
): Promise<Record<string, T>> {
  const keys = await getKeys(collection);
  const result: Record<string, T> = {};
  await Promise.all(keys.map(async (key) => {
    try {
      result[key] = await getObject<T>(collection, key);
    } catch {
      // skip keys that fail to load
    }
  }));
  return result;
}
