// confluence-client.ts
async function getSpaces() {
  const res = await fetch("cf/api/spaces");
  if (!res.ok) throw new Error(`confluence spaces fetch failed: ${res.status}`);
  return await res.json();
}
export {
  getSpaces
};
