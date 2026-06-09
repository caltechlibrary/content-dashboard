import { AppConfig } from "./config.ts";
import { makeLibGuides } from "./libguides.ts";

export function buildRouter(cfg: AppConfig) {
  const lg = makeLibGuides(cfg.proxy.libguides, cfg.proxy.cache);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/content-dashboard/api/config") {
      return Response.json(cfg.browser_config);
    }

    if (p === "/content-dashboard/api/whoami") {
      return handleWhoami(req);
    }

    if (p === "/content-dashboard/api/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    if (p === "/content-dashboard/api/libguides/accounts") {
      return lg.handleAccounts();
    }

    if (p === "/content-dashboard/api/libguides/guides") {
      return lg.handleGuides(url.searchParams);
    }

    return new Response("Not found", { status: 404 });
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
