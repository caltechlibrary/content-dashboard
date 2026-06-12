// lg-client.ts
async function getAccounts() {
  const res = await fetch("lg/api/accounts");
  if (!res.ok) throw new Error(`accounts fetch failed: ${res.status}`);
  return await res.json();
}
async function getGuides(query = {}) {
  const params = new URLSearchParams();
  if (query.status !== void 0) params.set("status", String(query.status));
  if (query.expand) params.set("expand", query.expand);
  const qs = params.toString();
  const res = await fetch(`lg/api/guides${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`guides fetch failed: ${res.status}`);
  return await res.json();
}
export {
  getAccounts,
  getGuides
};
