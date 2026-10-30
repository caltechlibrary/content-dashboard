import { parse } from "jsr:@std/yaml";

export interface BrowserConfig {
  stale_days: number;
  very_stale_days: number;
  session_key: string;
  session_cache_ttl_seconds?: number;
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

export interface ConfluenceConfig {
  base_url: string;
  email: string;
  api_token: string;
}

export interface CacheConfig {
  enabled: boolean;
  ttl_seconds: number;
}

export interface DatasetConfig {
  base_url: string;
}

export interface RouterConfig {
  port: number;
  libguides: LibGuidesConfig;
  confluence: ConfluenceConfig;
  cache: CacheConfig;
  dataset: DatasetConfig;
}

export interface AppConfig {
  browser_config: BrowserConfig;
  router: RouterConfig;
}

const DEFAULT_DATASET_BASE_URL = "http://localhost:8201";

export async function loadConfig(path: string): Promise<AppConfig> {
  const raw = await Deno.readTextFile(path);
  const cfg = parse(raw) as AppConfig;
  const lg = cfg.router.libguides;
  lg.client_id = expandEnv(lg.client_id);
  lg.client_secret = expandEnv(lg.client_secret);
  if (!lg.client_id || !lg.client_secret) {
    console.warn(
      "warning: LIBGUIDES_CLIENT_ID/LIBGUIDES_CLIENT_SECRET are empty — " +
        "/lg/api/* will return errors until .env is created (see DEPLOYMENT.md)",
    );
  }

  const cf = cfg.router.confluence;
  cf.email = expandEnv(cf.email);
  cf.api_token = expandEnv(cf.api_token);
  if (!cf.email || !cf.api_token) {
    console.warn(
      "warning: CONFLUENCE_EMAIL/CONFLUENCE_API_TOKEN are empty — " +
        "/cf/api/* will return errors until they are added to .env (see DEPLOYMENT.md)",
    );
  }

  if (!cfg.router.dataset) {
    cfg.router.dataset = { base_url: DEFAULT_DATASET_BASE_URL };
  } else if (!cfg.router.dataset.base_url) {
    cfg.router.dataset.base_url = DEFAULT_DATASET_BASE_URL;
  }
  cfg.router.dataset.base_url = expandEnv(cfg.router.dataset.base_url);

  return cfg;
}

function expandEnv(val: string): string {
  return val.replace(/\$\{([^}]+)\}/g, (_, k) => Deno.env.get(k) ?? "");
}
