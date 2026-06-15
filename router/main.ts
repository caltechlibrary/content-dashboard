import { loadConfig } from "./config.ts";
import { buildRouter } from "./routes.ts";

const configPath = Deno.args[0] ?? "../content_dashboard.yaml";
const cfg = await loadConfig(configPath);
const router = buildRouter(cfg);
const port = cfg.router.port;

console.log(`Router listening on localhost:${port}`);
Deno.serve({ hostname: "localhost", port }, router);
