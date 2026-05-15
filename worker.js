// Cloudflare Worker — Content Steward API proxy
// Deploy:  wrangler deploy
// Secrets: wrangler secret put LIBGUIDES_CLIENT_ID
//          wrangler secret put LIBGUIDES_CLIENT_SECRET
//          wrangler secret put GITHUB_TOKEN   (PAT with Contents: read+write on the repo)
// Vars:    set GITHUB_OWNER and GITHUB_REPO in wrangler.toml or via dashboard

const LIBGUIDES_BASE = 'https://lgapi-us.libapps.com';
const TOKEN_URL = `${LIBGUIDES_BASE}/1.2/oauth/token`;
const API_BASE  = `${LIBGUIDES_BASE}/1.2`;

// Per-isolate token cache.
let cachedToken  = null;
let tokenExpiresAt = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.LIBGUIDES_CLIENT_ID,
      client_secret: env.LIBGUIDES_CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  cachedToken    = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ── GitHub: commit stewardship.json ────────────────────────────────
async function saveStewardship(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const owner = env.GITHUB_OWNER;
  const repo  = env.GITHUB_REPO;
  const path  = 'stewardship.json';
  const ghHeaders = {
    Authorization:  `token ${env.GITHUB_TOKEN}`,
    Accept:         'application/vnd.github+json',
    'User-Agent':   'content-steward-worker',
    'Content-Type': 'application/json',
  };

  // Fetch current file to get its SHA (required for updates)
  let sha;
  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: ghHeaders }
  );
  if (getRes.ok) {
    const meta = await getRes.json();
    sha = meta.sha;
  } else if (getRes.status !== 404) {
    const err = await getRes.text();
    return jsonResponse({ error: `GitHub read failed: ${err}` }, 502);
  }

  // Encode content as base64
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(body, null, 2) + '\n')));

  const putPayload = {
    message: 'Update stewardship.json via Content Steward dashboard',
    content,
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { method: 'PUT', headers: ghHeaders, body: JSON.stringify(putPayload) }
  );

  if (!putRes.ok) {
    const err = await putRes.text();
    return jsonResponse({ error: `GitHub write failed: ${err}` }, 502);
  }

  return jsonResponse({ ok: true });
}

// ── Main handler ───────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const { pathname, search } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // POST /stewardship → commit stewardship.json to GitHub
    if (request.method === 'POST' && pathname === '/stewardship') {
      return saveStewardship(request, env);
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
    }

    // GET /* → proxy to LibGuides API
    try {
      const token  = await getAccessToken(env);
      const apiPath = pathname === '/' ? '/guides' : pathname;
      const apiUrl  = `${API_BASE}${apiPath}${search}`;

      const apiRes = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });

      // Strip PII from accounts before returning to client
      if (pathname === '/accounts' && apiRes.ok) {
        const accounts = await apiRes.json();
        const safe = accounts.map(({ id, first_name, last_name }) => ({ id, first_name, last_name }));
        return jsonResponse(safe);
      }

      const body = await apiRes.arrayBuffer();

      return new Response(body, {
        status: apiRes.status,
        headers: {
          'Content-Type': apiRes.headers.get('Content-Type') || 'application/json',
          'Cache-Control': 'no-store',
          ...corsHeaders(),
        },
      });
    } catch (err) {
      return jsonResponse({ error: 'Worker error', message: err.message }, 500);
    }
  },
};
