// ds-client.ts / htdocs/modules/ds-client.js
//
// Browser-side client for the router's /ds/api/* endpoints (proxied
// datasetd). Paths are document-relative so this works whether the page
// is served at http://localhost:8200/ (dev) or
// https://apps.library.caltech.edu/content-dashboard/ (prod).

export async function getKeys(collection: string): Promise<string[]> {
  const res = await fetch(`ds/api/${collection}/keys`);
  if (!res.ok) {
    throw new Error(`${collection} keys fetch failed: ${res.status}`);
  }
  // datasetd returns null, not an empty array, when a collection has no
  // records. Return an empty list so an empty collection reads as empty
  // instead of crashing the caller.
  const keys = await res.json();
  return Array.isArray(keys) ? keys : [];
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
  return await writeObject("PUT", collection, key, data);
}

// PUT silently no-ops on a key that doesn't exist yet (datasetd quirk) —
// use this for records that may not have been created before.
export async function postObject(
  collection: string,
  key: string,
  data: unknown,
): Promise<Response> {
  return await writeObject("POST", collection, key, data);
}

// Logs the status and response body when a write fails. datasetd rejects a
// bad record with a bare 400 and puts the reason in the body or an
// x-validation-errors header, so without this the console shows nothing and
// the save just quietly doesn't happen.
async function writeObject(
  method: "PUT" | "POST",
  collection: string,
  key: string,
  data: unknown,
): Promise<Response> {
  const url = `ds/api/${collection}/object/${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error(`[ds-client] ${method} ${url} network error:`, err);
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `[ds-client] ${method} ${url} failed: ${res.status} ${res.statusText}`,
      body,
    );
  }
  return res;
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
