import { loadConfig } from "./config.ts";
import { buildRouter } from "./routes.ts";

const configPath = Deno.args[0] ?? "../proxy_config.yaml";
const cfg = await loadConfig(configPath);
const router = buildRouter(cfg);
const port = cfg.proxy.port;

console.log(`Proxy listening on 127.0.0.1:${port}`);
Deno.serve({ hostname: "127.0.0.1", port }, router);
