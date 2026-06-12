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
  return await fetch(`ds/api/${collection}/object/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
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
  putObject
};
