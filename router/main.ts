import { loadConfig } from "./config.ts";
import { buildRouter } from "./routes.ts";

const configPath = Deno.args[0] ?? "../api_router.yaml";
const cfg = await loadConfig(configPath);
const router = buildRouter(cfg);
const port = cfg.router.port;

console.log(`Router listening on 127.0.0.1:${port}`);
Deno.serve({ hostname: "127.0.0.1", port }, router);
