// ds-client.ts
async function getKeys(collection) {
  const res = await fetch(`ds/api/${collection}/keys`);
  if (!res.ok) {
    throw new Error(`${collection} keys fetch failed: ${res.status}`);
  }
  return await res.json();
}
async function getObject(collection, key) {
  const res = await fetch(`ds/api/${collection}/object/${encodeURIComponent(key)}`);
  if (!res.ok) {
    throw new Error(`${collection} object "${key}" fetch failed: ${res.status}`);
  }
  return await res.json();
}
async function putObject(collection, key, data) {
  return await writeObject("PUT", collection, key, data);
}
async function postObject(collection, key, data) {
  return await writeObject("POST", collection, key, data);
}
async function writeObject(method, collection, key, data) {
  const url = `ds/api/${collection}/object/${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
  } catch (err) {
    console.error(`[ds-client] ${method} ${url} network error:`, err);
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[ds-client] ${method} ${url} failed: ${res.status} ${res.statusText}`, body);
  }
  return res;
}
async function getAllObjects(collection) {
  const keys = await getKeys(collection);
  const result = {};
  await Promise.all(keys.map(async (key) => {
    try {
      result[key] = await getObject(collection, key);
    } catch {
    }
  }));
  return result;
}
export {
  getAllObjects,
  getKeys,
  getObject,
  postObject,
  putObject
};
