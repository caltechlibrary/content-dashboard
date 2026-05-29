// ── Configuration ──────────────────────────────────────────────────
// Populated at startup by loadConfig() via GET /api/config from the proxy.
// In development, create htdocs/dev-config.js (gitignored) to set:
//   window.__DEV_CONFIG__ = { apiBase: 'http://localhost:8080', datasetBase: 'http://localhost:8200' };
let CONFIG = {};

async function loadConfig() {
  const dev = window.__DEV_CONFIG__ || {};
  const apiBase      = dev.apiBase      ?? '';
  const datasetBase  = dev.datasetBase  ?? '';

  const res = await fetch(`${apiBase}/content-dashboard/api/config`);
  if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
  const remote = await res.json();

  CONFIG = {
    STALE_DAYS:            remote.stale_days,
    VERY_STALE_DAYS:       remote.very_stale_days,
    SESSION_KEY:           remote.session_key,
    WEBSITE_PAGE_GROUPS:   remote.website_page_groups,
    RESEARCH_GUIDE_GROUPS: remote.research_guide_groups,
    DEPARTMENTS:           remote.departments,
    apiBase,
    datasetBase,
    currentUser: 'unknown',
  };
}

async function loadCurrentUser() {
  try {
    const res = await fetch(`${CONFIG.apiBase}/content-dashboard/api/whoami`);
    if (res.ok) {
      const data = await res.json();
      CONFIG.currentUser = data.user || 'unknown';
    }
  } catch { /* leave as 'unknown' */ }
}

// ── State ──────────────────────────────────────────────────────────
const state = {
  view: 'my-website-pages',
  report: 'stale',
  pages: [],          // processed PageRecord[]
  names: [],          // sorted staff names (from /accounts, or derived from guide data)
  guideOptions: [],   // sorted unique guide titles
  selectedName: '',   // shared across Website Pages + Research Guides
  stewardship: {},    // page_id → { expert, editor } from KV
  audit: {},          // 'page:{id}' | 'guide:{id}' → { links, accessibility, accuracy }
  manageFilters: { guide: '', showAssigned: true, showUnassigned: true },
  wpSort:  { col: 'guide', dir: 'asc' },
  rgSort:  { col: 'guide', dir: 'asc' },
  msSort:  { col: 'guide', dir: 'asc' },
  // sort col names: 'expert' (was 'steward'), 'editor' (was 'deputy')
  reportFilters: {
    stale:        { expert: '', olderThan: '' },
    unpublished:  {},
    unassigned: { guide: '', missing: 'either' },
    missing:    { guide: '' },
    hidden:     { guide: '' },
    'rg-stale':       { owner: '', olderThan: '' },
    'rg-hidden':      { guide: '' },
    'rg-unpublished': {},
  },
};

// ── Helpers ────────────────────────────────────────────────────────
function sortTh(label, col, sortState) {
  const active = sortState.col === col;
  const arrow  = active ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : ' ▲';
  const cls    = `sort-th${active ? ' sort-th-active' : ''}`;
  return `<th class="${cls}" data-sort="${col}">${label}<span class="sort-indicator${active ? ' sort-active' : ''}">${arrow}</span></th>`;
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function decodeEntities(str) {
  return String(str ?? '')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#039;/g,"'");
}

function el(id) { return document.getElementById(id); }

// LibGuides returns "YYYY-MM-DD HH:MM:SS" — treat as UTC.
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}

function daysAgo(str) {
  const d = parseDate(str);
  return d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : Infinity;
}

function formatDate(str) {
  const d = parseDate(str);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric', timeZone:'UTC' });
}

function formatTimestamp(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}

const UNASSIGNED_RE   = /^(tbd|please add|--|n\/a|none|placeholder|add name)$/i;
const DIVISION_CODE_RE = /^\([A-Z]{1,6}\)$/;

function isUnassigned(val) {
  if (!val || val.trim() === '') return true;
  const v = val.trim();
  return UNASSIGNED_RE.test(v) || DIVISION_CODE_RE.test(v);
}

function freshnessStatus(updatedStr) {
  const d = daysAgo(updatedStr);
  if (d > CONFIG.VERY_STALE_DAYS) return 'very-stale';
  if (d > CONFIG.STALE_DAYS)      return 'stale';
  return 'current';
}

// Badge HTML using exact mockup palette classes
function freshnessBadge(status) {
  const map = {
    'current':    ['badge-ok',     'Current'],
    'stale':      ['badge-warn',   'Stale'],
    'very-stale': ['badge-danger', 'Very stale'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function roleBadge(role) {
  if (role === 'both')   return '<span class="badge badge-info">Both</span>';
  if (role === 'expert') return '<span class="badge badge-info">Expert</span>';
  if (role === 'editor') return '<span class="badge badge-info">Editor</span>';
  return '';
}

function dateTd(updatedStr) {
  const status = freshnessStatus(updatedStr);
  const cls = status === 'very-stale' ? 'date-very-stale'
             : status === 'stale'      ? 'date-stale'
             : 'col-guide';
  return `<td class="${cls}">${esc(formatDate(updatedStr))}</td>`;
}

function pageLink(p) {
  const link = p.pageFriendlyUrl
    ? `<a class="page-link" href="${esc(p.pageFriendlyUrl)}" target="_blank" rel="noopener">${esc(p.pageLabel)}</a>`
    : esc(p.pageLabel);
  const redirectBadge = p.pageRedirectUrl ? ` <span class="badge badge-muted">redirected</span>` : '';
  const hiddenBadge   = String(p.enableDisplay) !== '1' ? ` <span class="badge badge-muted">hidden</span>` : '';
  return link + redirectBadge + hiddenBadge;
}

function auditCells(key) {
  const a = state.audit[key] || {};
  return ['links', 'accessibility', 'accuracy'].map(field =>
    `<td class="col-audit-check">
      <input type="checkbox" class="audit-cb" aria-label="${field}"
        data-audit-key="${esc(key)}" data-field="${field}"
        ${a[field] ? 'checked' : ''}>
    </td>`
  ).join('');
}

async function syncAudit(btnId) {
  const btn = el(btnId);
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  await new Promise(r => setTimeout(r, 2500));
  try {
    const base = CONFIG.datasetBase;
    const keysRes = await fetch(`${base}/content-dashboard/api/audit.ds/keys`);
    if (keysRes.ok) {
      const keys = await keysRes.json();
      const fresh = {};
      await Promise.all(keys.map(async key => {
        const r = await fetch(`${base}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`);
        if (r.ok) fresh[key] = await r.json();
      }));
      state.audit = { ...state.audit, ...fresh };
      localStorage.setItem('audit_cache', JSON.stringify(state.audit));
    }
  } catch { /* keep local state */ }
  renderCurrentView();
  const freshBtn = el(btnId);
  if (freshBtn) {
    freshBtn.textContent = '✓ Saved';
    setTimeout(() => { const b = el(btnId); if (b) { b.textContent = 'Save Audit'; b.disabled = false; } }, 1500);
  }
}

function auditTfoot(tbodyId, leadingCols) {
  const fields = ['links', 'accessibility', 'accuracy'];
  return `<tfoot><tr>
    <td colspan="${leadingCols}"></td>
    ${fields.map(f => `<td class="col-audit-check">
      <a href="#" class="audit-clear-link" data-field="${f}" data-tbody="${tbodyId}">clear</a>
    </td>`).join('')}
  </tr></tfoot>`;
}

async function clearAuditField(field, tbodyId) {
  const tbody = el(tbodyId);
  if (!tbody) return;
  const checkboxes = tbody.querySelectorAll(`.audit-cb[data-field="${field}"]`);
  const keysToUpdate = [];
  for (const cb of checkboxes) {
    const key = cb.dataset.auditKey;
    if (state.audit[key]?.[field]) {
      state.audit[key] = { ...state.audit[key], [field]: false };
      keysToUpdate.push(key);
    }
    cb.checked = false;
  }
  if (keysToUpdate.length === 0) return;
  localStorage.setItem('audit_cache', JSON.stringify(state.audit));
  await Promise.all(keysToUpdate.map(key => {
    const [type, ...rest] = key.split(':');
    const id = rest.join(':');
    return fetch(`${CONFIG.datasetBase}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id, ...state.audit[key], updatedBy: CONFIG.currentUser }),
    });
  }));
}

async function saveAuditCheck(key, field, checked) {
  const current = { ...(state.audit[key] || {}) };
  current[field] = checked;
  state.audit[key] = current;
  localStorage.setItem('audit_cache', JSON.stringify(state.audit));
  const [type, ...rest] = key.split(':');
  const id = rest.join(':');
  await fetch(`${CONFIG.datasetBase}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, id, ...current, updatedBy: CONFIG.currentUser }),
  });
}

function expertCell(name) {
  return name ? esc(name) : '<span class="muted-italic">Unassigned</span>';
}

function editorCell(name) {
  return name ? esc(name) : '<span class="muted-italic">—</span>';
}

// ── Stewardship box parsing ────────────────────────────────────────
function parseStewardshipBox(html) {
  if (!html || !html.includes('Page Steward:')) return null;
  const div = document.createElement('div');
  div.innerHTML = html;
  const alert = div.querySelector('.alert.alert-info');
  if (!alert) return null;
  const inner = alert.innerHTML;
  const expertM    = inner.match(/Page Steward:<\/strong>\s*([^<\n]*)/i);
  const editorM    = inner.match(/Page Deputy:<\/strong>\s*([^<\n]*)/i);
  const updatedByM = inner.match(/Last Updated by:<\/strong>\s*([^<\n]*)/i);
  return {
    expert:        expertM    ? expertM[1].trim()    : null,
    editor:        editorM    ? editorM[1].trim()    : null,
    lastUpdatedBy: updatedByM ? updatedByM[1].trim() : null,
  };
}

function findStewardship(boxes) {
  for (const box of (boxes || [])) {
    if (!box.content) continue;
    const parsed = parseStewardshipBox(box.content);
    if (parsed) return parsed;
  }
  return null;
}

// ── Data processing ────────────────────────────────────────────────
function processGuides(guides) {
  const pages = [];
  const nameSet  = new Set();
  const guideSet = new Set();

  for (const guide of guides) {
    if (!Array.isArray(guide.pages)) continue;
    const guideTitle = decodeEntities(guide.title || guide.name || '(untitled guide)');
    const ownerName = guide.owner
      ? `${guide.owner.first_name ?? ''} ${guide.owner.last_name ?? ''}`.trim()
      : null;

    for (const page of guide.pages) {
      // stewardship.json is the primary source; box HTML parsing is the fallback
      const jsonEntry = state.stewardship[String(page.id)];
      let rawExpert, rawEditor, lastUpdatedBy, hasStewardshipBox;

      if (jsonEntry) {
        rawExpert         = jsonEntry.expert || null;
        rawEditor         = jsonEntry.editor || null;
        hasStewardshipBox = true;
      } else {
        const sh          = findStewardship(page.boxes);
        rawExpert         = sh?.expert        ?? null;
        rawEditor         = sh?.editor        ?? null;
        lastUpdatedBy     = sh?.lastUpdatedBy ?? null;
        hasStewardshipBox = sh !== null;
      }

      const expert     = isUnassigned(rawExpert) ? null : rawExpert;
      const editor     = isUnassigned(rawEditor) ? null : rawEditor;
      const department = jsonEntry?.department || null;

      if (expert)    nameSet.add(expert);
      if (editor)    nameSet.add(editor);
      if (ownerName) nameSet.add(ownerName);
      guideSet.add(guideTitle);

      pages.push({
        guideId:           guide.id,
        guideTitle,
        guideOwner:        ownerName,
        guideFriendlyUrl:  guide.friendly_url || guide.url || null,
        groupId:           guide.group_id != null ? Number(guide.group_id) : null,
        pageId:            page.id,
        pageLabel:         page.label || page.name || '(untitled)',
        pageFriendlyUrl:   page.friendly_url || page.url || null,
        pageRedirectUrl:   page.redirect_url || null,
        updated:           page.updated || null,
        guideUpdated:      guide.updated || null,
        enableDisplay:     page.enable_display ?? 1,
        expert,
        editor,
        department,
        lastUpdatedBy,
        hasStewardshipBox,
        freshness:         freshnessStatus(page.updated),
      });
    }
  }

  state.pages       = pages;
  if (state.names.length === 0) {
    state.names = Array.from(nameSet).sort((a,b) => a.localeCompare(b));
  }
  state.guideOptions = Array.from(guideSet).sort((a,b) => a.localeCompare(b));
}

// ── Data fetching ──────────────────────────────────────────────────
async function loadData(force = false) {
  // Load stewardship from datasetd
  try {
    const base = CONFIG.datasetBase;
    const keysRes = await fetch(`${base}/content-dashboard/api/stewardship.ds/keys`);
    if (keysRes.ok) {
      const keys = await keysRes.json();
      const result = {};
      await Promise.all(keys.map(async key => {
        const r = await fetch(`${base}/content-dashboard/api/stewardship.ds/object/${encodeURIComponent(key)}`);
        if (r.ok) result[key] = await r.json();
      }));
      state.stewardship = result;
    }
  } catch { /* datasetd unavailable — stewardship stays empty */ }

  // Fetch staff accounts for name lists (proxy strips PII, only id/first_name/last_name returned)
  try {
    const ar = await fetch(`${CONFIG.apiBase}/content-dashboard/api/libguides/accounts`);
    if (ar.ok) {
      const accounts = await ar.json();
      state.names = accounts
        .filter(a => {
          if (!a.first_name && !a.last_name) return false;
          if ((a.last_name || '').includes('(test)')) return false;
          return true;
        })
        .map(a => `${a.first_name} ${a.last_name}`.trim())
        .filter(Boolean)
        .sort((a,b) => a.localeCompare(b));
    }
  } catch { /* fall back to names derived from guide data */ }

  // Load audit state — localStorage first (instant), then KV merged on top
  try {
    const local = localStorage.getItem('audit_cache');
    if (local) state.audit = JSON.parse(local);
  } catch { state.audit = {}; }

  try {
    const base = CONFIG.datasetBase;
    const keysRes = await fetch(`${base}/content-dashboard/api/audit.ds/keys`);
    if (keysRes.ok) {
      const keys = await keysRes.json();
      const fresh = {};
      await Promise.all(keys.map(async key => {
        const r = await fetch(`${base}/content-dashboard/api/audit.ds/object/${encodeURIComponent(key)}`);
        if (r.ok) fresh[key] = await r.json();
      }));
      // datasetd wins so other people's changes come through; local fills in recent unsynced writes
      state.audit = { ...state.audit, ...fresh };
      localStorage.setItem('audit_cache', JSON.stringify(state.audit));
    }
  } catch { /* datasetd unavailable — use local cache */ }

  if (!force) {
    const cached = sessionStorage.getItem(CONFIG.SESSION_KEY);
    if (cached) {
      try {
        const { data, ts } = JSON.parse(cached);
        processGuides(data);
        updateLastFetched(ts);
        renderCurrentView();
        return;
      } catch { /* fall through to fetch */ }
    }
  }

  showOverlay('loading');
  try {
    const res = await fetch(`${CONFIG.apiBase}/content-dashboard/api/libguides/guides?status=1&expand=pages,pages.boxes,owner`);
    if (!res.ok) throw new Error(`Guides API: HTTP ${res.status}`);
    const guides = await res.json();
    const ts = Date.now();
    sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({ data: guides, ts }));
    processGuides(guides);
    updateLastFetched(ts);
    showOverlay(null);
    renderCurrentView();
  } catch (err) {
    showOverlay('error', err.message);
  }
}

function updateLastFetched(ts) {
  const e = el('last-fetched');
  if (e && ts) e.textContent = `Fetched ${formatTimestamp(ts)}`;
}

function showOverlay(type, msg) {
  el('loading').classList.toggle('hidden', type !== 'loading');
  el('error').classList.toggle('hidden',   type !== 'error');
  if (type === 'error' && msg) el('error-msg').textContent = msg;
}

// ── Select option builders ─────────────────────────────────────────
function nameOptions(selected = '') {
  return state.names.map(n =>
    `<option value="${esc(n)}" ${n === selected ? 'selected':''}>${esc(n)}</option>`
  ).join('');
}

function guideOpts(selected = '') {
  return state.guideOptions.map(g =>
    `<option value="${esc(g)}" ${g === selected ? 'selected':''}>${esc(g)}</option>`
  ).join('');
}

function websiteGuideOpts(selected = '') {
  const titles = [...new Set(
    state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId)).map(p => p.guideTitle)
  )].sort((a,b) => a.localeCompare(b));
  return titles.map(g => `<option value="${esc(g)}" ${g === selected ? 'selected':''}>${esc(g)}</option>`).join('');
}

function researchGuideOpts(selected = '') {
  const titles = [...new Set(
    state.pages.filter(p => CONFIG.RESEARCH_GUIDE_GROUPS.includes(p.groupId)).map(p => p.guideTitle)
  )].sort((a,b) => a.localeCompare(b));
  return titles.map(g => `<option value="${esc(g)}" ${g === selected ? 'selected':''}>${esc(g)}</option>`).join('');
}

function researchOwnerOpts(selected = '') {
  const owners = [...new Set(
    state.pages.filter(p => CONFIG.RESEARCH_GUIDE_GROUPS.includes(p.groupId) && p.guideOwner).map(p => p.guideOwner)
  )].sort((a,b) => a.localeCompare(b));
  return owners.map(n => `<option value="${esc(n)}" ${n === selected ? 'selected':''}>${esc(n)}</option>`).join('');
}

// ── View: Website Pages ─────────────────────────────────────────
function renderMyWebsitePages() {
  const name = state.selectedName;
  const container = el('view-my-website-pages');
  const pool = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId));
  const pages = name ? pool.filter(p => p.expert === name || p.editor === name) : pool;
  const needsUpdate = pages.filter(p => p.freshness !== 'current').length;

  let metricsHtml, metricsCols;
  if (name) {
    metricsCols = 4;
    const asExpert  = pages.filter(p => p.expert === name).length;
    const asEditor  = pages.filter(p => p.editor === name).length;
    const missEdit  = pages.filter(p => p.expert === name && !p.editor).length;
    metricsHtml = `
      <div class="metric"><div class="metric-label">Expert on</div><div class="metric-value">${asExpert}</div></div>
      <div class="metric"><div class="metric-label">Editor on</div><div class="metric-value">${asEditor}</div></div>
      <div class="metric"><div class="metric-label">Needs update</div><div class="metric-value${needsUpdate > 0 ? ' danger' : ''}">${needsUpdate}</div></div>
      <div class="metric"><div class="metric-label">Missing web editor</div><div class="metric-value${missEdit > 0 ? ' danger' : ''}">${missEdit}</div></div>`;
  } else {
    metricsCols = 2;
    metricsHtml = `
      <div class="metric"><div class="metric-label">Total pages</div><div class="metric-value">${pool.length}</div></div>
      <div class="metric"><div class="metric-label">Needs update</div><div class="metric-value${needsUpdate > 0 ? ' danger' : ''}">${needsUpdate}</div></div>`;
  }

  const wpSort = state.wpSort;
  const sorted = [...pages].sort((a, b) => {
    let va, vb;
    if      (wpSort.col === 'guide')      { va = a.guideTitle  || ''; vb = b.guideTitle  || ''; }
    else if (wpSort.col === 'page')       { va = a.pageLabel   || ''; vb = b.pageLabel   || ''; }
    else if (wpSort.col === 'expert')     { va = a.expert      || ''; vb = b.expert      || ''; }
    else if (wpSort.col === 'editor')     { va = a.editor      || ''; vb = b.editor      || ''; }
    else if (wpSort.col === 'department') { va = a.department  || ''; vb = b.department  || ''; }
    else if (wpSort.col === 'updated')    { va = a.updated     || ''; vb = b.updated     || ''; }
    const cmp = String(va).localeCompare(String(vb));
    return wpSort.dir === 'asc' ? cmp : -cmp;
  });

  const rowsHtml = sorted.length === 0
    ? `<tr><td colspan="9"><div class="empty-state">No pages found.</div></td></tr>`
    : sorted.map(p => {
        const dateClass = p.freshness === 'very-stale' ? 'date-very-stale'
                        : p.freshness === 'stale'      ? 'date-stale' : '';
        return `<tr>
          <td title="${esc(p.pageLabel)}">${pageLink(p)}</td>
          <td class="col-guide" title="${esc(p.guideTitle)}">${esc(p.guideTitle)}</td>
          <td><span class="${p.expert ? 'chip-assigned' : 'chip-unassigned'}">${esc(p.expert || 'unassigned')}</span></td>
          <td><span class="${p.editor ? 'chip-assigned' : 'chip-unassigned'}">${esc(p.editor || 'unassigned')}</span></td>
          <td><span class="${p.department ? 'chip-assigned' : 'chip-unassigned'}">${esc(p.department || 'unassigned')}</span></td>
          <td class="${dateClass}">${esc(formatDate(p.updated))}</td>
          ${auditCells('page:' + p.pageId)}
        </tr>`;
      }).join('');

  container.innerHTML = `
    <div class="topbar"><h1>Website Pages</h1><button class="btn-primary" id="wp-audit-save">Save Audit</button></div>
    <div class="content">
      <div class="filter-row">
        <label class="filter-label" for="wp-name">Filter To:</label>
        <select id="wp-name">
          <option value="">All Website Pages</option>
          ${nameOptions(name)}
        </select>
        ${name ? '<a href="#" class="filter-reset-link" id="wp-reset">show all</a>' : ''}
      </div>
      <div class="metrics" style="grid-template-columns:repeat(${metricsCols},1fr)">${metricsHtml}</div>
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:20%"><col style="width:17%">
            <col style="width:10%"><col style="width:10%"><col style="width:11%"><col style="width:12%">
            <col style="width:7%"><col style="width:7%"><col style="width:6%">
          </colgroup>
          <thead>
            <tr>
              ${sortTh('Page', 'page', wpSort)}
              ${sortTh('Guide', 'guide', wpSort)}
              ${sortTh('Expert', 'expert', wpSort)}
              ${sortTh('Editor', 'editor', wpSort)}
              ${sortTh('Department', 'department', wpSort)}
              ${sortTh('Last updated', 'updated', wpSort)}
              <th class="col-audit-check">Links</th><th class="col-audit-check">A11y</th><th class="col-audit-check">Accuracy</th>
            </tr>
          </thead>
          <tbody id="wp-audit-tbody">${rowsHtml}</tbody>
          ${auditTfoot('wp-audit-tbody', 6)}
        </table>
      </div>
    </div>`;

  el('wp-name')?.addEventListener('change', e => { state.selectedName = e.target.value; renderCurrentView(); });
  el('wp-reset')?.addEventListener('click', e => { e.preventDefault(); state.selectedName = ''; renderCurrentView(); });
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      state.wpSort = state.wpSort.col === col
        ? { col, dir: state.wpSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' };
      renderCurrentView();
    });
  });
  el('wp-audit-tbody')?.addEventListener('change', e => {
    const cb = e.target.closest('.audit-cb');
    if (!cb) return;
    saveAuditCheck(cb.dataset.auditKey, cb.dataset.field, cb.checked);
  });
  el('wp-audit-tbody')?.closest('table')?.addEventListener('click', e => {
    const link = e.target.closest('.audit-clear-link');
    if (!link) return;
    e.preventDefault();
    clearAuditField(link.dataset.field, link.dataset.tbody);
  });
  el('wp-audit-save')?.addEventListener('click', () => syncAudit('wp-audit-save'));
}

function renderMyResearchGuides() {
  const name = state.selectedName;
  const container = el('view-my-research-guides');

  const pool = state.pages.filter(p => CONFIG.RESEARCH_GUIDE_GROUPS.includes(p.groupId));

  // Build guide map from all guides
  const allGuideMap = new Map();
  for (const p of pool) {
    if (!allGuideMap.has(p.guideId)) {
      allGuideMap.set(p.guideId, { guideId: p.guideId, guideTitle: p.guideTitle, guideOwner: p.guideOwner, guideFriendlyUrl: p.guideFriendlyUrl, guideUpdated: p.guideUpdated, pages: [] });
    }
    allGuideMap.get(p.guideId).pages.push(p);
  }

  const rgSort = state.rgSort;
  const allGuides = Array.from(allGuideMap.values()).map(g => {
    const visiblePages = g.pages.filter(p => String(p.enableDisplay) === '1');
    return { ...g, pageCount: visiblePages.length, freshness: freshnessStatus(g.guideUpdated) };
  }).sort((a, b) => {
    let va, vb;
    if      (rgSort.col === 'guide')   { va = a.guideTitle  || ''; vb = b.guideTitle  || ''; }
    else if (rgSort.col === 'owner')   { va = a.guideOwner  || ''; vb = b.guideOwner  || ''; }
    else if (rgSort.col === 'pages')   { va = a.pageCount;          vb = b.pageCount; return rgSort.dir === 'asc' ? va - vb : vb - va; }
    else if (rgSort.col === 'updated') { va = a.guideUpdated || ''; vb = b.guideUpdated || ''; }
    const cmp = String(va).localeCompare(String(vb));
    return rgSort.dir === 'asc' ? cmp : -cmp;
  });

  const ownerNames = [...new Set(allGuides.map(g => g.guideOwner).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const ownerOpts = ownerNames.map(n =>
    `<option value="${esc(n)}" ${n === name ? 'selected':''}>${esc(n)}</option>`
  ).join('');

  const guides = name ? allGuides.filter(g => g.guideOwner === name) : allGuides;
  const needsUpdate = guides.filter(g => g.freshness !== 'current').length;

  const rowsHtml = guides.map(g => {
    const titleHtml = g.guideFriendlyUrl
      ? `<a class="page-link" href="${esc(g.guideFriendlyUrl)}" target="_blank" rel="noopener">${esc(g.guideTitle)}</a>`
      : esc(g.guideTitle);
    const dateClass = g.freshness === 'very-stale' ? 'date-very-stale'
                    : g.freshness === 'stale'      ? 'date-stale' : '';
    return `<tr>
      <td title="${esc(g.guideTitle)}">${titleHtml}</td>
      <td title="${esc(g.guideOwner || '')}">${esc(g.guideOwner || '—')}</td>
      <td class="col-count">${g.pageCount}</td>
      <td class="${dateClass}">${esc(formatDate(g.guideUpdated))}</td>
      ${auditCells('guide:' + g.guideId)}
    </tr>`;
  }).join('') || `<tr><td colspan="7"><div class="empty-state">No research guides found.</div></td></tr>`;

  container.innerHTML = `
    <div class="topbar"><h1>Research Guides</h1><button class="btn-primary" id="rg-audit-save">Save Audit</button></div>
    <div class="content">
      <div class="filter-row">
        <label class="filter-label" for="rg-name">Filter To:</label>
        <select id="rg-name">
          <option value="">All Research Guides</option>
          ${ownerOpts}
        </select>
        ${name ? '<a href="#" class="filter-reset-link" id="rg-reset">show all</a>' : ''}
      </div>
      <div class="metrics" style="grid-template-columns:repeat(2,1fr)">
        <div class="metric">
          <div class="metric-label">${name ? 'Guides owned' : 'Total guides'}</div>
          <div class="metric-value">${guides.length}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Needs update</div>
          <div class="metric-value${needsUpdate > 0 ? ' danger' : ''}">${needsUpdate}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:29%"><col style="width:18%"><col style="width:9%">
            <col style="width:23%">
            <col style="width:7%"><col style="width:7%"><col style="width:7%">
          </colgroup>
          <thead>
            <tr>
              ${sortTh('Guide', 'guide', rgSort)}
              ${sortTh('Owner', 'owner', rgSort)}
              <th class="col-count sort-th${rgSort.col === 'pages' ? ' sort-th-active' : ''}" data-sort="pages">Pages<span class="sort-indicator${rgSort.col === 'pages' ? ' sort-active' : ''}">${rgSort.col === 'pages' ? (rgSort.dir === 'asc' ? ' ▲' : ' ▼') : ' ▲'}</span></th>
              ${sortTh('Last updated', 'updated', rgSort)}
              <th class="col-audit-check">Links</th><th class="col-audit-check">A11y</th><th class="col-audit-check">Accuracy</th>
            </tr>
          </thead>
          <tbody id="rg-audit-tbody">${rowsHtml}</tbody>
          ${auditTfoot('rg-audit-tbody', 4)}
        </table>
      </div>
    </div>`;

  el('rg-audit-tbody')?.addEventListener('change', e => {
    const cb = e.target.closest('.audit-cb');
    if (!cb) return;
    saveAuditCheck(cb.dataset.auditKey, cb.dataset.field, cb.checked);
  });

  el('rg-audit-tbody')?.closest('table')?.addEventListener('click', e => {
    const link = e.target.closest('.audit-clear-link');
    if (!link) return;
    e.preventDefault();
    clearAuditField(link.dataset.field, link.dataset.tbody);
  });

  el('rg-audit-save')?.addEventListener('click', () => syncAudit('rg-audit-save'));

  el('rg-name')?.addEventListener('change', e => { state.selectedName = e.target.value; renderCurrentView(); });
  el('rg-reset')?.addEventListener('click', e => { e.preventDefault(); state.selectedName = ''; renderCurrentView(); });
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      state.rgSort = state.rgSort.col === col
        ? { col, dir: state.rgSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' };
      renderCurrentView();
    });
  });
}


// ── View: Reports ──────────────────────────────────────────────────
const WEBSITE_REPORTS = [
  { id:'stale',        icon:'🕐', title:'Stale content',        desc:'Pages not updated recently. Good for identifying maintenance priorities.' },
  { id:'hidden',       icon:'🙈', title:'Hidden website pages',          desc:'Pages that are hidden. May be drafts or retired content worth reviewing.' },
  { id:'unpublished',  icon:'📋', title:'Unpublished pages',    desc:'Pages in draft status not visible to patrons. Good to run during cleanup.' },
];

const RESEARCH_REPORTS = [
  { id:'rg-stale',       icon:'🕐', title:'Stale guides',      desc:'Guides not updated recently. Good for identifying maintenance priorities.' },
  { id:'rg-hidden',      icon:'🙈', title:'Hidden guide pages',       desc:'Guides with hidden pages. May be drafts or retired content worth reviewing.' },
  { id:'rg-unpublished', icon:'📋', title:'Unpublished guides', desc:'Guides in draft status not visible to patrons. Good to run during cleanup.' },
];

function renderReports() {
  const container = el('view-reports');

  const cardHtml = r => `
    <div class="report-card ${r.id === state.report ? 'active' : ''}" data-report="${r.id}" role="button" tabindex="0">
      <span class="report-card-icon">${r.icon}</span>
      <div>
        <h3>${r.title}</h3>
        <p>${r.desc}</p>
      </div>
    </div>`;

  container.innerHTML = `
    <div class="topbar">
      <h1>Reports</h1>
    </div>
    <div class="content">
      <div class="report-columns">
        <div class="report-col">
          <h2 class="report-col-heading">Website Pages</h2>
          <div class="report-grid">${WEBSITE_REPORTS.map(cardHtml).join('')}</div>
        </div>
        <div class="report-col">
          <h2 class="report-col-heading">Research Guides</h2>
          <div class="report-grid">${RESEARCH_REPORTS.map(cardHtml).join('')}</div>
        </div>
      </div>
      <div id="report-panel"></div>
    </div>`;

  container.querySelectorAll('.report-card').forEach(card => {
    const activate = () => { state.report = card.dataset.report; renderReports(); };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); activate(); } });
  });

  renderReportPanel();
}

function renderReportPanel() {
  const panel = el('report-panel');
  if (!panel) return;
  switch (state.report) {
    case 'stale':       renderStalePanel(panel);       break;
    case 'unassigned':  renderUnassignedPanel(panel);  break;
    case 'missing':     renderMissingPanel(panel);     break;
    case 'hidden':      renderHiddenPanel(panel);      break;
    case 'unpublished': renderUnpublishedPanel(panel); break;
    case 'rg-stale':       renderRgStalePanel(panel);       break;
    case 'rg-hidden':      renderRgHiddenPanel(panel);      break;
    case 'rg-unpublished': renderRgUnpublishedPanel(panel); break;
  }
}

// ── Report: Stale content ──────────────────────────────────────────
function renderStalePanel(panel) {
  const f = state.reportFilters.stale;
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Stale content report</p>
      <div class="filter-row">
        <label class="filter-label">Not updated since</label>
        <input type="date" id="r-stale-before" value="${f.olderThan}">
        <select id="r-stale-steward">
          <option value="">All content experts</option>
          ${nameOptions(f.expert)}
        </select>
        <button class="btn-run" id="r-stale-run">Run report</button>
      </div>
      <div id="r-stale-results"></div>
    </div>`;

  el('r-stale-before')?.addEventListener('change',  e => { state.reportFilters.stale.olderThan = e.target.value; });
  el('r-stale-steward')?.addEventListener('change', e => { state.reportFilters.stale.expert = e.target.value; });
  el('r-stale-run')?.addEventListener('click', () => runStaleReport());

  // Auto-run if filters already set
  if (f.olderThan || f.expert) runStaleReport();
  else el('r-stale-results').innerHTML = emptyPromptHtml();
}

function runStaleReport() {
  const f = state.reportFilters.stale;
  // Read current input values (user may not have fired change event)
  const before = el('r-stale-before')?.value  || f.olderThan;
  const expert  = el('r-stale-steward')?.value || f.expert;
  state.reportFilters.stale.olderThan = before;
  state.reportFilters.stale.expert    = expert;

  let data = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId) && (p.freshness === 'stale' || p.freshness === 'very-stale'));
  if (expert) data = data.filter(p => p.expert === expert || p.editor === expert);
  if (before) {
    const cutoff = new Date(before).getTime();
    data = data.filter(p => { const d = parseDate(p.updated); return d && d.getTime() < cutoff; });
  }

  const rowsHtml = data.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${data.length} result${data.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-stale-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:26%"><col style="width:22%"><col style="width:16%"><col style="width:16%"><col style="width:12%"><col style="width:8%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Expert</th><th>Editor</th><th>Last updated</th><th>Status</th></tr></thead>
         <tbody>${data.map(p=>`<tr>
           <td>${pageLink(p)}</td>
           <td class="col-guide">${esc(p.guideTitle)}</td>
           <td>${expertCell(p.expert)}</td>
           <td>${editorCell(p.editor)}</td>
           ${dateTd(p.updated)}
           <td>${freshnessBadge(p.freshness)}</td>
         </tr>`).join('')}</tbody>
       </table></div>`;

  el('r-stale-results').innerHTML = rowsHtml;
  el('r-stale-export')?.addEventListener('click', () => exportCSV('stale-content.csv', data, [
    { label:'Page',           get: p => p.pageLabel },
    { label:'Guide',          get: p => p.guideTitle },
    { label:'Expert', get: p => p.expert ?? '' },
    { label:'Editor',     get: p => p.editor ?? '' },
    { label:'Last updated', get: p => formatDate(p.updated) },
    { label:'Days ago',     get: p => daysAgo(p.updated) },
    { label:'Status',       get: p => p.freshness },
    { label:'URL',          get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

// ── Report: Unassigned pages ───────────────────────────────────────
function renderUnassignedPanel(panel) {
  const f = state.reportFilters.unassigned;
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Unassigned pages report</p>
      <div class="filter-row">
        <label class="filter-label">Guide</label>
        <select id="r-un-guide">
          <option value="">All guides</option>
          ${websiteGuideOpts(f.guide)}
        </select>
        <label class="filter-label">Missing</label>
        <select id="r-un-missing">
          <option value="either"  ${f.missing==='either'  ?'selected':''}>Expert or Editor</option>
          <option value="expert"  ${f.missing==='expert'  ?'selected':''}>Expert only</option>
          <option value="editor"  ${f.missing==='editor'  ?'selected':''}>Editor only</option>
        </select>
        <button class="btn-run" id="r-un-run">Run report</button>
      </div>
      <div id="r-un-results"></div>
    </div>`;

  el('r-un-guide')?.addEventListener('change',   e => { state.reportFilters.unassigned.guide   = e.target.value; });
  el('r-un-missing')?.addEventListener('change', e => { state.reportFilters.unassigned.missing = e.target.value; });
  el('r-un-run')?.addEventListener('click', () => runUnassignedReport());
  el('r-un-results').innerHTML = emptyPromptHtml();
}

function runUnassignedReport() {
  const guide   = el('r-un-guide')?.value   || '';
  const missing = el('r-un-missing')?.value || 'either';
  state.reportFilters.unassigned.guide   = guide;
  state.reportFilters.unassigned.missing = missing;

  let data = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId) && p.hasStewardshipBox && (!p.expert || !p.editor));
  if (guide)           data = data.filter(p => p.guideTitle === guide);
  if (missing==='expert') data = data.filter(p => !p.expert);
  if (missing==='editor') data = data.filter(p => !p.editor);

  const rowsHtml = data.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${data.length} result${data.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-un-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:28%"><col style="width:24%"><col style="width:18%"><col style="width:18%"><col style="width:12%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Expert</th><th>Editor</th><th>Missing</th></tr></thead>
         <tbody>${data.map(p=>{
           const miss = [!p.expert&&'Expert', !p.editor&&'Editor'].filter(Boolean).join(', ');
           return `<tr>
             <td>${pageLink(p)}</td>
             <td class="col-guide">${esc(p.guideTitle)}</td>
             <td>${expertCell(p.expert)}</td>
             <td>${editorCell(p.editor)}</td>
             <td>${esc(miss)}</td>
           </tr>`;
         }).join('')}</tbody>
       </table></div>`;

  el('r-un-results').innerHTML = rowsHtml;
  el('r-un-export')?.addEventListener('click', () => exportCSV('unassigned-pages.csv', data, [
    { label:'Page',           get: p => p.pageLabel },
    { label:'Guide',          get: p => p.guideTitle },
    { label:'Expert', get: p => p.expert ?? '' },
    { label:'Editor',     get: p => p.editor ?? '' },
    { label:'Missing',        get: p => [!p.expert&&'Expert', !p.editor&&'Editor'].filter(Boolean).join(', ') },
    { label:'URL',            get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

// ── Report: Missing stewardship box ───────────────────────────────
function renderMissingPanel(panel) {
  const f = state.reportFilters.missing;
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Missing stewardship record report</p>
      <div class="filter-row">
        <label class="filter-label">Guide</label>
        <select id="r-mb-guide">
          <option value="">All guides</option>
          ${websiteGuideOpts(f.guide)}
        </select>
        <button class="btn-run" id="r-mb-run">Run report</button>
      </div>
      <div id="r-mb-results"></div>
    </div>`;

  el('r-mb-guide')?.addEventListener('change', e => { state.reportFilters.missing.guide = e.target.value; });
  el('r-mb-run')?.addEventListener('click', () => runMissingReport());
  el('r-mb-results').innerHTML = emptyPromptHtml();
}

function runMissingReport() {
  const guide = el('r-mb-guide')?.value || '';
  state.reportFilters.missing.guide = guide;

  let data = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId) && !p.hasStewardshipBox);
  if (guide) data = data.filter(p => p.guideTitle === guide);

  const rowsHtml = data.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${data.length} result${data.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-mb-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:30%"><col style="width:26%"><col style="width:22%"><col style="width:22%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Guide owner</th><th>Last updated</th></tr></thead>
         <tbody>${data.map(p=>`<tr>
           <td>${pageLink(p)}</td>
           <td class="col-guide">${esc(p.guideTitle)}</td>
           <td class="col-guide">${p.guideOwner ? esc(p.guideOwner) : '<span class="muted-italic">—</span>'}</td>
           ${dateTd(p.updated)}
         </tr>`).join('')}</tbody>
       </table></div>`;

  el('r-mb-results').innerHTML = rowsHtml;
  el('r-mb-export')?.addEventListener('click', () => exportCSV('missing-stewardship-box.csv', data, [
    { label:'Page',         get: p => p.pageLabel },
    { label:'Guide',        get: p => p.guideTitle },
    { label:'Guide owner',  get: p => p.guideOwner ?? '' },
    { label:'Last updated', get: p => formatDate(p.updated) },
    { label:'URL',          get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

// ── Report: Hidden pages ───────────────────────────────────────────
function renderHiddenPanel(panel) {
  const f = state.reportFilters.hidden;
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Hidden pages report</p>
      <div class="filter-row">
        <label class="filter-label">Guide</label>
        <select id="r-hp-guide">
          <option value="">All guides</option>
          ${websiteGuideOpts(f.guide)}
        </select>
        <button class="btn-run" id="r-hp-run">Run report</button>
      </div>
      <div id="r-hp-results"></div>
    </div>`;

  el('r-hp-guide')?.addEventListener('change', e => { state.reportFilters.hidden.guide = e.target.value; });
  el('r-hp-run')?.addEventListener('click', () => runHiddenReport());
  el('r-hp-results').innerHTML = emptyPromptHtml();
}

function runHiddenReport() {
  const guide = el('r-hp-guide')?.value || '';
  state.reportFilters.hidden.guide = guide;

  let data = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId) && String(p.enableDisplay) !== '1');
  if (guide) data = data.filter(p => p.guideTitle === guide);

  const rowsHtml = data.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${data.length} result${data.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-hp-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:30%"><col style="width:26%"><col style="width:22%"><col style="width:22%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Expert</th><th>Last updated</th></tr></thead>
         <tbody>${data.map(p=>`<tr>
           <td>${pageLink(p)}</td>
           <td class="col-guide">${esc(p.guideTitle)}</td>
           <td>${expertCell(p.expert)}</td>
           ${dateTd(p.updated)}
         </tr>`).join('')}</tbody>
       </table></div>`;

  el('r-hp-results').innerHTML = rowsHtml;
  el('r-hp-export')?.addEventListener('click', () => exportCSV('hidden-pages.csv', data, [
    { label:'Page',           get: p => p.pageLabel },
    { label:'Guide',          get: p => p.guideTitle },
    { label:'Expert', get: p => p.expert ?? '' },
    { label:'Last updated', get: p => formatDate(p.updated) },
    { label:'URL',          get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

// ── Report: Stale research guides ─────────────────────────────────
function renderRgStalePanel(panel) {
  const f = state.reportFilters['rg-stale'];
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Stale guides report</p>
      <div class="filter-row">
        <label class="filter-label">Not updated since</label>
        <input type="date" id="r-rgs-before" value="${f.olderThan}">
        <select id="r-rgs-owner">
          <option value="">All owners</option>
          ${researchOwnerOpts(f.owner)}
        </select>
        <button class="btn-run" id="r-rgs-run">Run report</button>
      </div>
      <div id="r-rgs-results"></div>
    </div>`;

  el('r-rgs-before')?.addEventListener('change',  e => { state.reportFilters['rg-stale'].olderThan = e.target.value; });
  el('r-rgs-owner')?.addEventListener('change',   e => { state.reportFilters['rg-stale'].owner     = e.target.value; });
  el('r-rgs-run')?.addEventListener('click', () => runRgStaleReport());

  if (f.olderThan || f.owner) runRgStaleReport();
  else el('r-rgs-results').innerHTML = emptyPromptHtml();
}

function runRgStaleReport() {
  const before = el('r-rgs-before')?.value  || '';
  const owner  = el('r-rgs-owner')?.value   || '';
  state.reportFilters['rg-stale'].olderThan = before;
  state.reportFilters['rg-stale'].owner     = owner;

  const pool = state.pages.filter(p => CONFIG.RESEARCH_GUIDE_GROUPS.includes(p.groupId));

  // Group into guides
  const guideMap = new Map();
  for (const p of pool) {
    if (!guideMap.has(p.guideId)) {
      guideMap.set(p.guideId, { guideId: p.guideId, guideTitle: p.guideTitle, guideFriendlyUrl: p.guideFriendlyUrl, guideOwner: p.guideOwner, pages: [] });
    }
    guideMap.get(p.guideId).pages.push(p);
  }

  let guides = Array.from(guideMap.values()).map(g => {
    const withDates = g.pages.filter(p => p.updated).sort((a,b) =>
      (parseDate(a.updated)?.getTime() ?? 0) - (parseDate(b.updated)?.getTime() ?? 0)
    );
    const oldestUpdated = withDates.length ? withDates[0].updated : null;
    const latestUpdated = withDates.length ? withDates[withDates.length - 1].updated : null;
    const visiblePages = g.pages.filter(p => String(p.enableDisplay) === '1');
    return { ...g, pageCount: visiblePages.length, oldestUpdated, latestUpdated, freshness: freshnessStatus(oldestUpdated) };
  }).filter(g => g.freshness === 'stale' || g.freshness === 'very-stale');

  if (owner) guides = guides.filter(g => g.guideOwner === owner);
  if (before) {
    const cutoff = new Date(before).getTime();
    guides = guides.filter(g => { const d = parseDate(g.oldestUpdated); return d && d.getTime() < cutoff; });
  }

  guides.sort((a,b) => a.guideTitle.localeCompare(b.guideTitle));

  const rowsHtml = guides.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${guides.length} result${guides.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-rgs-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:25%"><col style="width:20%"><col style="width:10%"><col style="width:20%"><col style="width:17%"><col style="width:8%"></colgroup>
         <thead><tr><th>Guide</th><th>Owner</th><th class="col-count">Pages</th><th>Oldest updated</th><th>Latest updated</th><th>Status</th></tr></thead>
         <tbody>${guides.map(g => {
           const titleHtml = g.guideFriendlyUrl
             ? `<a class="page-link" href="${esc(g.guideFriendlyUrl)}" target="_blank" rel="noopener">${esc(g.guideTitle)}</a>`
             : esc(g.guideTitle);
           const dateClass = g.freshness === 'very-stale' ? 'date-very-stale' : 'date-stale';
           return `<tr>
             <td>${titleHtml}</td>
             <td class="col-guide">${esc(g.guideOwner || '—')}</td>
             <td class="col-count">${g.pageCount}</td>
             <td class="${dateClass}">${esc(formatDate(g.oldestUpdated))}</td>
             <td class="col-guide">${esc(formatDate(g.latestUpdated))}</td>
             <td>${freshnessBadge(g.freshness)}</td>
           </tr>`;
         }).join('')}</tbody>
       </table></div>`;

  el('r-rgs-results').innerHTML = rowsHtml;
  el('r-rgs-export')?.addEventListener('click', () => exportCSV('stale-research-guides.csv', guides, [
    { label:'Guide',          get: g => g.guideTitle },
    { label:'Owner',          get: g => g.guideOwner ?? '' },
    { label:'',  get: g => g.pageCount },
    { label:'Oldest updated', get: g => formatDate(g.oldestUpdated) },
    { label:'Latest updated', get: g => formatDate(g.latestUpdated) },
    { label:'Status',         get: g => g.freshness },
    { label:'URL',            get: g => g.guideFriendlyUrl ?? '' },
  ]));
}

// ── Report: Hidden pages in research guides ────────────────────────
function renderRgHiddenPanel(panel) {
  const f = state.reportFilters['rg-hidden'];
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Hidden pages in research guides report</p>
      <div class="filter-row">
        <label class="filter-label">Guide</label>
        <select id="r-rgh-guide">
          <option value="">All guides</option>
          ${researchGuideOpts(f.guide)}
        </select>
        <button class="btn-run" id="r-rgh-run">Run report</button>
      </div>
      <div id="r-rgh-results"></div>
    </div>`;

  el('r-rgh-guide')?.addEventListener('change', e => { state.reportFilters['rg-hidden'].guide = e.target.value; });
  el('r-rgh-run')?.addEventListener('click', () => runRgHiddenReport());
  el('r-rgh-results').innerHTML = emptyPromptHtml();
}

function runRgHiddenReport() {
  const guide = el('r-rgh-guide')?.value || '';
  state.reportFilters['rg-hidden'].guide = guide;

  let data = state.pages.filter(p => CONFIG.RESEARCH_GUIDE_GROUPS.includes(p.groupId) && String(p.enableDisplay) !== '1');
  if (guide) data = data.filter(p => p.guideTitle === guide);

  const rowsHtml = data.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${data.length} result${data.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-rgh-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:28%"><col style="width:28%"><col style="width:22%"><col style="width:22%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Owner</th><th>Last updated</th></tr></thead>
         <tbody>${data.map(p => `<tr>
           <td>${pageLink(p)}</td>
           <td class="col-guide">${esc(p.guideTitle)}</td>
           <td class="col-guide">${esc(p.guideOwner || '—')}</td>
           ${dateTd(p.updated)}
         </tr>`).join('')}</tbody>
       </table></div>`;

  el('r-rgh-results').innerHTML = rowsHtml;
  el('r-rgh-export')?.addEventListener('click', () => exportCSV('hidden-research-pages.csv', data, [
    { label:'Page',         get: p => p.pageLabel },
    { label:'Guide',        get: p => p.guideTitle },
    { label:'Owner',        get: p => p.guideOwner ?? '' },
    { label:'Last updated', get: p => formatDate(p.updated) },
    { label:'URL',          get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

// ── Report: Unpublished website guides ────────────────────────────
function renderUnpublishedPanel(panel) {
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Unpublished pages report</p>
      <div class="filter-row">
        <button class="btn-run" id="r-wpu-run">Run report</button>
      </div>
      <div id="r-wpu-results"></div>
    </div>`;
  el('r-wpu-run')?.addEventListener('click', () => runUnpublishedReport());
  el('r-wpu-results').innerHTML = emptyPromptHtml();
}

async function runUnpublishedReport() {
  const resultsEl = el('r-wpu-results');
  const btn = el('r-wpu-run');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  resultsEl.innerHTML = '';

  let guides;
  try {
    const res = await fetch(`${CONFIG.apiBase}/content-dashboard/api/libguides/guides?status=0&expand=pages,owner`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    guides = await res.json();
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-state">Failed to load: ${esc(err.message)}</div>`;
    btn.textContent = 'Run report';
    btn.disabled = false;
    return;
  }

  btn.textContent = 'Run report';
  btn.disabled = false;

  guides = guides.filter(g => CONFIG.WEBSITE_PAGE_GROUPS.includes(Number(g.group_id)));

  const rows = [];
  for (const g of guides) {
    const guideTitle = decodeEntities(g.name || g.title || '(untitled)');
    const owner      = g.owner ? `${g.owner.first_name ?? ''} ${g.owner.last_name ?? ''}`.trim() : '—';
    for (const p of (g.pages || [])) {
      const pageLabel = decodeEntities(p.label || p.name || '(untitled)');
      const pageUrl   = p.friendly_url || p.url || null;
      const pageHtml  = pageUrl
        ? `<a class="page-link" href="${esc(pageUrl)}" target="_blank" rel="noopener">${esc(pageLabel)}</a>`
        : esc(pageLabel);
      rows.push({ pageLabel, pageUrl, guideTitle, owner, updated: formatDate(p.updated), pageHtml });
    }
  }
  rows.sort((a, b) => a.guideTitle.localeCompare(b.guideTitle) || a.pageLabel.localeCompare(b.pageLabel));

  if (!rows.length) {
    resultsEl.innerHTML = `<div class="empty-state">No unpublished pages found.</div>`;
    return;
  }

  resultsEl.innerHTML = `
    <div class="result-actions">
      <span class="result-count">${rows.length} result${rows.length !== 1 ? 's' : ''}</span>
      <button class="btn-export" id="r-wpu-export">Export CSV</button>
    </div>
    <div class="table-wrap"><table>
      <colgroup><col style="width:28%"><col style="width:28%"><col style="width:22%"><col style="width:22%"></colgroup>
      <thead><tr><th>Page</th><th>Guide</th><th>Owner</th><th>Last updated</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.pageHtml}</td>
        <td class="col-guide">${esc(r.guideTitle)}</td>
        <td class="col-guide">${esc(r.owner)}</td>
        <td>${esc(r.updated)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  el('r-wpu-export')?.addEventListener('click', () => exportCSV('unpublished-website-pages.csv', rows, [
    { label:'Page',         get: r => r.pageLabel },
    { label:'Guide',        get: r => r.guideTitle },
    { label:'Owner',        get: r => r.owner },
    { label:'Last updated', get: r => r.updated },
    { label:'URL',          get: r => r.pageUrl ?? '' },
  ]));
}

// ── Report: Unpublished research guides ───────────────────────────
function renderRgUnpublishedPanel(panel) {
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Unpublished guides report</p>
      <div class="filter-row">
        <button class="btn-run" id="r-rgu-run">Run report</button>
      </div>
      <div id="r-rgu-results"></div>
    </div>`;
  el('r-rgu-run')?.addEventListener('click', () => runRgUnpublishedReport());
  el('r-rgu-results').innerHTML = emptyPromptHtml();
}

async function runRgUnpublishedReport() {
  const resultsEl = el('r-rgu-results');
  const btn = el('r-rgu-run');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  resultsEl.innerHTML = '';

  let guides;
  try {
    const res = await fetch(`${CONFIG.apiBase}/content-dashboard/api/libguides/guides?status=0&expand=pages,owner`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    guides = await res.json();
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-state">Failed to load: ${esc(err.message)}</div>`;
    btn.textContent = 'Run report';
    btn.disabled = false;
    return;
  }

  btn.textContent = 'Run report';
  btn.disabled = false;

  guides = guides.filter(g => CONFIG.RESEARCH_GUIDE_GROUPS.includes(Number(g.group_id)));

  const rows = [];
  for (const g of guides) {
    const guideTitle = decodeEntities(g.name || g.title || '(untitled)');
    const owner      = g.owner ? `${g.owner.first_name ?? ''} ${g.owner.last_name ?? ''}`.trim() : '—';
    for (const p of (g.pages || [])) {
      const pageLabel = decodeEntities(p.label || p.name || '(untitled)');
      const pageUrl   = p.friendly_url || p.url || null;
      const pageHtml  = pageUrl
        ? `<a class="page-link" href="${esc(pageUrl)}" target="_blank" rel="noopener">${esc(pageLabel)}</a>`
        : esc(pageLabel);
      rows.push({ pageLabel, pageUrl, guideTitle, owner, updated: formatDate(p.updated), pageHtml });
    }
  }
  rows.sort((a, b) => a.guideTitle.localeCompare(b.guideTitle) || a.pageLabel.localeCompare(b.pageLabel));

  if (!rows.length) {
    resultsEl.innerHTML = `<div class="empty-state">No unpublished pages found.</div>`;
    return;
  }

  resultsEl.innerHTML = `
    <div class="result-actions">
      <span class="result-count">${rows.length} result${rows.length !== 1 ? 's' : ''}</span>
      <button class="btn-export" id="r-rgu-export">Export CSV</button>
    </div>
    <div class="table-wrap"><table>
      <colgroup><col style="width:28%"><col style="width:28%"><col style="width:22%"><col style="width:22%"></colgroup>
      <thead><tr><th>Page</th><th>Guide</th><th>Owner</th><th>Last updated</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.pageHtml}</td>
        <td class="col-guide">${esc(r.guideTitle)}</td>
        <td class="col-guide">${esc(r.owner)}</td>
        <td>${esc(r.updated)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  el('r-rgu-export')?.addEventListener('click', () => exportCSV('unpublished-research-pages.csv', rows, [
    { label:'Page',         get: r => r.pageLabel },
    { label:'Guide',        get: r => r.guideTitle },
    { label:'Owner',        get: r => r.owner },
    { label:'Last updated', get: r => r.updated },
    { label:'URL',          get: r => r.pageUrl ?? '' },
  ]));
}

function emptyPromptHtml() {
  return `<div class="empty-state">Select a report above and run it to see results.</div>`;
}

// ── View: Assign Roles ──────────────────────────────────────────
function renderManageStewards() {
  const f = state.manageFilters;
  const container = el('view-manage-stewards');

  let filtered = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId));
  if (f.guide) filtered = filtered.filter(p => p.guideTitle === f.guide);
  if (!f.showAssigned)   filtered = filtered.filter(p => !p.expert && !p.editor && !p.department);
  if (!f.showUnassigned) filtered = filtered.filter(p => p.expert || p.editor || p.department);
  const msSort = state.msSort;
  filtered = [...filtered].sort((a, b) => {
    let va, vb;
    if      (msSort.col === 'guide')      { va = a.guideTitle  || ''; vb = b.guideTitle  || ''; }
    else if (msSort.col === 'page')       { va = a.pageLabel   || ''; vb = b.pageLabel   || ''; }
    else if (msSort.col === 'expert')     { va = a.expert      || ''; vb = b.expert      || ''; }
    else if (msSort.col === 'editor')     { va = a.editor      || ''; vb = b.editor      || ''; }
    else if (msSort.col === 'department') { va = a.department  || ''; vb = b.department  || ''; }
    const cmp = String(va).localeCompare(String(vb));
    return msSort.dir === 'asc' ? cmp : -cmp;
  });

  const nameListId = 'steward-names-list';
  const nameListHtml = `
    <datalist id="${nameListId}">
      ${state.names.map(n => `<option value="${esc(n)}">`).join('')}
    </datalist>`;

  const guideOptHtml = state.pages
    .filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId))
    .map(p => p.guideTitle)
    .filter((t,i,a) => t && a.indexOf(t) === i)
    .sort()
    .map(t => `<option value="${esc(t)}" ${t === f.guide ? 'selected' : ''}>${esc(t)}</option>`)
    .join('');

  const rowsHtml = filtered.length === 0
    ? `<tr><td colspan="5"><div class="empty-state">No pages match the current filters.</div></td></tr>`
    : filtered.map(p => `
        <tr data-page-id="${p.pageId}">
          <td title="${esc(p.pageLabel)}">${pageLink(p)}</td>
          <td class="col-guide" title="${esc(p.guideTitle)}">${esc(p.guideTitle)}</td>
          <td>
            <input class="steward-input" type="text" list="${nameListId}"
              data-field="expert" data-page-id="${p.pageId}"
              aria-label="Expert for ${esc(p.pageLabel)}"
              value="${esc(p.expert || '')}" placeholder="unassigned">
          </td>
          <td>
            <input class="steward-input" type="text" list="${nameListId}"
              data-field="editor" data-page-id="${p.pageId}"
              aria-label="Editor for ${esc(p.pageLabel)}"
              value="${esc(p.editor || '')}" placeholder="unassigned">
          </td>
          <td>
            <select class="steward-input" data-field="department" data-page-id="${p.pageId}"
              data-empty="${!p.department}"
              aria-label="Department for ${esc(p.pageLabel)}">
              <option value="">unassigned</option>
              ${CONFIG.DEPARTMENTS.map(d => `<option value="${esc(d)}" ${p.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
            </select>
          </td>
        </tr>`).join('');

  container.innerHTML = `
    ${nameListHtml}
    <div class="topbar">
      <h1>Assign Roles</h1>
    </div>
    <div class="content">
      <div class="filter-row">
        <label class="filter-label" for="ms-guide">Filter by Guide:</label>
        <select id="ms-guide">
          <option value="">All Pages</option>
          ${guideOptHtml}
        </select>
        <label class="checkbox-label">
          <input type="checkbox" id="ms-show-assigned" ${f.showAssigned ? 'checked' : ''}> Assigned
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="ms-show-unassigned" ${f.showUnassigned ? 'checked' : ''}> Unassigned
        </label>
      </div>
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:22%"><col style="width:26%">
            <col style="width:17%"><col style="width:17%"><col style="width:18%">
          </colgroup>
          <thead>
            <tr>
              ${sortTh('Page', 'page', msSort)}
              ${sortTh('Guide', 'guide', msSort)}
              ${sortTh('Expert', 'expert', msSort)}
              ${sortTh('Editor', 'editor', msSort)}
              ${sortTh('Department', 'department', msSort)}
            </tr>
          </thead>
          <tbody id="ms-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;

  el('ms-guide')?.addEventListener('change', e => { state.manageFilters.guide = e.target.value; renderManageStewards(); });
  el('ms-show-assigned')?.addEventListener('change', e => { state.manageFilters.showAssigned = e.target.checked; renderManageStewards(); });
  el('ms-show-unassigned')?.addEventListener('change', e => { state.manageFilters.showUnassigned = e.target.checked; renderManageStewards(); });
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      state.msSort = state.msSort.col === col
        ? { col, dir: state.msSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' };
      renderManageStewards();
    });
  });

  // Inline edit — save to KV on change
  el('ms-tbody')?.addEventListener('change', e => {
    const input = e.target.closest('.steward-input');
    if (!input) return;
    const pageId = input.dataset.pageId;
    const field  = input.dataset.field;
    const value  = input.value.trim();
    if (input.tagName === 'SELECT') input.dataset.empty = String(!value);

    if (!state.stewardship[pageId]) state.stewardship[pageId] = { expert: '', editor: '', department: '' };
    state.stewardship[pageId][field] = value;

    // Keep page record in sync so other views reflect the change immediately
    const page = state.pages.find(p => String(p.pageId) === String(pageId));
    if (page) {
      if (field === 'expert')     page.expert     = isUnassigned(value) ? null : value;
      if (field === 'editor')     page.editor     = isUnassigned(value) ? null : value;
      if (field === 'department') page.department = value || null;
    }

    const entry = state.stewardship[pageId];
    fetch(`${CONFIG.datasetBase}/content-dashboard/api/stewardship.ds/object/${encodeURIComponent(pageId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, expert: entry.expert || '', editor: entry.editor || '', department: entry.department || '', updatedBy: CONFIG.currentUser }),
    });
  });
}


// ── CSV export ─────────────────────────────────────────────────────
function exportCSV(filename, rows, columns) {
  const header = columns.map(c => csvCell(c.label)).join(',');
  const body   = rows.map(r => columns.map(c => csvCell(c.get(r))).join(',')).join('\n');
  const blob   = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url    = URL.createObjectURL(blob);
  const a      = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(v) { return '"' + String(v ?? '').replace(/"/g,'""') + '"'; }

// ── Navigation ─────────────────────────────────────────────────────
function switchView(view) {
  state.view = view;
  localStorage.setItem('last_view', view);
  document.querySelectorAll('.nav-item[data-view]').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  renderCurrentView();
}

function renderCurrentView() {
  const viewEl = el(`view-${state.view}`);
  if (!viewEl) return;
  viewEl.classList.remove('hidden');
  switch (state.view) {
    case 'my-website-pages':   renderMyWebsitePages();   break;
    case 'my-research-guides': renderMyResearchGuides(); break;
    case 'reports':            renderReports();          break;
    case 'manage-stewards':    renderManageStewards();   break;
  }
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const savedView = localStorage.getItem('last_view');
  if (savedView) state.view = savedView;

  // Hide all views; renderCurrentView will unhide the right one after data loads
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); switchView(item.dataset.view); });
    item.classList.toggle('active', item.dataset.view === state.view);
  });
  el('refresh-btn')?.addEventListener('click', () => loadData(true));
  el('retry-btn')?.addEventListener('click',   () => loadData(true));

  try {
    await loadConfig();
  } catch (err) {
    showOverlay('error', `Failed to load configuration: ${err.message}`);
    return;
  }
  await loadCurrentUser();
  loadData();
});
