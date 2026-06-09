import { loadConfig } from "./config.ts";
import { buildRouter } from "./routes.ts";

const configPath = Deno.args[0] ?? "../content_dashboard.yaml";
const cfg = await loadConfig(configPath);
const router = buildRouter(cfg);
const port = cfg.proxy.port;

console.log(`Proxy listening on :${port}`);
Deno.serve({ port }, router);
