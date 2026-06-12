// Reverse proxy for /ds/* — forwards to datasetd's JSON API.
//
// /ds/api/stewardship.ds/keys -> ${baseUrl}/api/stewardship.ds/keys
// /ds                         -> ${baseUrl}/

// Hop-by-hop headers (RFC 7230 §6.1) plus Host and Content-Length.
// Host must not be forwarded to the upstream (it names the original
// browser-facing host, not datasetd). Content-Length is recomputed by
// fetch from the body — forwarding the original value can cause framing
// errors.
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

function filterHeaders(src: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of src) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      out.set(key, value);
    }
  }
  return out;
}

export type DatasetProxyHandler = (
  req: Request,
  pathname: string,
) => Promise<Response>;

export function makeDatasetProxy(baseUrl: string): DatasetProxyHandler {
  const base = baseUrl.replace(/\/+$/, "");

  return async (req: Request, pathname: string): Promise<Response> => {
    const rest = pathname.replace(/^\/ds/, "") || "/";

    const reqUrl = new URL(req.url);
    const targetUrl = new URL(base + rest);
    targetUrl.search = reqUrl.search;

    const headers = filterHeaders(req.headers);
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        ...(hasBody ? { duplex: "half" as const } : {}),
        redirect: "manual",
      });
    } catch (err) {
      console.error("dataset proxy error:", err);
      return new Response(
        JSON.stringify({ error: "dataset service unavailable" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: filterHeaders(upstream.headers),
    });
  };
}
