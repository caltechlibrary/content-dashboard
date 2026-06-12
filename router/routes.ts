import { serveDir } from "jsr:@std/http/file-server";
import { AppConfig } from "./config.ts";
import { makeLibGuides } from "./libguides.ts";
import { makeDatasetProxy } from "./dataset.ts";

const HTDOCS_ROOT = new URL("../htdocs", import.meta.url).pathname;

export function buildRouter(cfg: AppConfig) {
  const lg = makeLibGuides(cfg.router.libguides, cfg.router.cache);
  const dsProxy = makeDatasetProxy(cfg.router.dataset.base_url);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/api/config") {
      return Response.json(cfg.browser_config);
    }

    if (p === "/api/whoami") {
      return handleWhoami(req);
    }

    if (p === "/api/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    if (p === "/lg/api/accounts") {
      return lg.handleAccounts();
    }

    if (p === "/lg/api/guides") {
      return lg.handleGuides(url.searchParams);
    }

    if (p === "/ds" || p.startsWith("/ds/")) {
      return dsProxy(req, p);
    }

    return serveDir(req, { fsRoot: HTDOCS_ROOT, quiet: true });
  };
}

function handleWhoami(req: Request): Response {
  const user =
    req.headers.get("Remote-User") ??
    req.headers.get("remote-user") ??
    Deno.env.get("DEV_USER") ??
    "dev-user";
  return Response.json({ user });
}
