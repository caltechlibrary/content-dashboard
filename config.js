// Update WORKER_URL to your deployed Cloudflare Worker endpoint before going live.
const CONFIG = {
  WORKER_URL: 'https://restless-sea-ca3c.twila.workers.dev',
  STALE_DAYS: 365,
  VERY_STALE_DAYS: 730,
  SESSION_KEY: 'cs_guides_v1',
  WEBSITE_PAGE_GROUPS:   [26856, 27077],
  RESEARCH_GUIDE_GROUPS: [10729],
  DEPARTMENTS: ['Archives', 'ACS', 'CLOPS', 'DLD', 'LIT', 'RS'],
  GITHUB_OWNER: 'caltechlibrary',
  GITHUB_REPO:  'content-dashboard',
};
