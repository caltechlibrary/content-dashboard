import { parse } from "jsr:@std/yaml";

export interface BrowserConfig {
  stale_days: number;
  very_stale_days: number;
  session_key: string;
  website_page_groups: number[];
  research_guide_groups: number[];
  departments: string[];
}

export interface LibGuidesConfig {
  base_url: string;
  token_url: string;
  client_id: string;
  client_secret: string;
}

export interface CacheConfig {
  enabled: boolean;
  ttl_seconds: number;
}

export interface ProxyConfig {
  port: number;
  libguides: LibGuidesConfig;
  cache: CacheConfig;
}

export interface AppConfig {
  browser_config: BrowserConfig;
  proxy: ProxyConfig;
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const raw = await Deno.readTextFile(path);
  const cfg = parse(raw) as AppConfig;
  const lg = cfg.proxy.libguides;
  lg.client_id = expandEnv(lg.client_id);
  lg.client_secret = expandEnv(lg.client_secret);
  if (!lg.client_id || !lg.client_secret) {
    console.warn(
      "warning: LIBGUIDES_CLIENT_ID/LIBGUIDES_CLIENT_SECRET are empty — " +
        "/content-dashboard/api/libguides/* will return errors until .env is " +
        "created (see DEPLOYMENT.md)",
    );
  }
  return cfg;
}

function expandEnv(val: string): string {
  return val.replace(/\$\{([^}]+)\}/g, (_, k) => Deno.env.get(k) ?? "");
}
