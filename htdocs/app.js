import { getAccounts, getGuides } from './modules/lg-client.js';
import { getAllObjects, putObject, postObject } from './modules/ds-client.js';

// Configuration
// Populated at startup by loadConfig() via GET api/config from the router.
let CONFIG = {};

async function loadConfig() {
  const res = await fetch('api/config');
  if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
  const remote = await res.json();

  CONFIG = {
    STALE_DAYS:            remote.stale_days,
    VERY_STALE_DAYS:       remote.very_stale_days,
    SESSION_KEY:           remote.session_key,
    SESSION_CACHE_TTL_MS:  (remote.session_cache_ttl_seconds ?? 900) * 1000,
    WEBSITE_PAGE_GROUPS:   remote.website_page_groups,
    RESEARCH_GUIDE_GROUPS: remote.research_guide_groups,
    DEPARTMENTS:           remote.departments,
    currentUser: 'unknown',
  };
}

async function loadCurrentUser() {
  try {
    const res = await fetch('api/whoami');
    if (res.ok) {
      const data = await res.json();
      CONFIG.currentUser = data.user || 'unknown';
    }
  } catch { /* leave as 'unknown' */ }
}

// State 
const state = {
  view: 'my-website-pages',
  report: 'stale',
  pages: [],          // processed PageRecord[]
  names: [],          // sorted staff names (from /accounts, or derived from guide data)
  guideOptions: [],   // sorted unique guide titles
  selectedName: '',   // shared across Website Pages + Research Guides
  stewardship: {},    // page_id → { expert } from datasetd
  audit: {},          // 'page:{id}' | 'guide:{id}' → { links, accessibility, accuracy }
  manageFilters: { page: '', guide: '', expert: '', department: '' },
  wpFilters: { page: '', guide: '', expert: '', department: '', hideHidden: false, hideRedirected: false },
  rgFilters: { guide: '', owner: '' },
  wpSort:  { col: 'guide', dir: 'asc' },
  rgSort:  { col: 'guide', dir: 'asc' },   // RG only sorts by 'guide' (default) or 'updated' (Last updated column)
  reportFilters: {
    stale:        { expert: '', olderThan: '' },
    unpublished:  {},
    hidden:     { guide: '' },
    'rg-stale':       { owner: '', olderThan: '' },
    'rg-hidden':      { guide: '' },
    'rg-unpublished': {},
  },
};

// Helpers
function sortTh(label, col, sortState) {
  const active = sortState.col === col;
  const arrow  = active ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : ' ▲';
  const cls    = `sort-th${active ? ' sort-th-active' : ''}`;
  return `<th scope="col" class="${cls}" data-sort="${col}">${label}<span class="sort-indicator${active ? ' sort-active' : ''}">${arrow}</span></th>`;
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
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('en-US', { month:'short', day:'numeric' })} ${time}`;
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
    : `<span class="page-link">${esc(p.pageLabel)}</span>`;
  const redirectBadge = p.pageRedirectUrl ? `<span class="badge badge-muted">redirected</span>` : '';
  const hiddenBadge   = String(p.enableDisplay) !== '1' ? `<span class="badge badge-muted">hidden</span>` : '';
  return `<div class="page-cell">${link}${redirectBadge}${hiddenBadge}</div>`;
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


function auditTfoot(tbodyId, leadingCols) {
  const fields = ['links', 'accessibility', 'accuracy'];
  return `<tfoot><tr>
    <td colspan="${leadingCols}"></td>
    ${fields.map(f => `<td class="col-audit-check">
      <a href="#" class="audit-clear-link" data-field="${f}" data-tbody="${tbodyId}">clear</a>
    </td>`).join('')}
  </tr></tfoot>`;
}

// Build a complete audit record. datasetd needs all three check fields present
// on every write (even with validation off) or it rejects the record with a 400.
function auditPayload(key, state_) {
  const [type, ...rest] = key.split(':');
  const id = rest.join(':');
  return {
    type, id,
    links:         !!state_.links,
    accessibility: !!state_.accessibility,
    accuracy:      !!state_.accuracy,
    updatedBy:     CONFIG.currentUser,
  };
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
  await Promise.all(keysToUpdate.map(key =>
    putObject('audit.ds', key, auditPayload(key, state.audit[key]))));
}

async function saveAuditCheck(key, field, checked) {
  const isNewRecord = !state.audit[key];
  const current = { ...(state.audit[key] || {}) };
  current[field] = checked;
  state.audit[key] = current;
  const payload = auditPayload(key, current);
  // PUT silently no-ops if the record doesn't exist yet — use POST to create it.
  if (isNewRecord) await postObject('audit.ds', key, payload);
  else             await putObject('audit.ds', key, payload);
}

function expertCell(name) {
  return name ? esc(name) : '<span class="chip-unassigned">unassigned</span>';
}

//  Data processing 
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
      const jsonEntry         = state.stewardship[String(page.id)];
      const expert            = jsonEntry?.expert || null;
      const department        = jsonEntry?.department || null;
      if (expert)    nameSet.add(expert);
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
        department,
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

// Data fetching
async function loadData(force = false) {
  // Load stewardship from datasetd
  try {
    state.stewardship = await getAllObjects('stewardship.ds');
  } catch { console.error('datasetd unavailable — stewardship data not loaded'); }

  // Fetch staff accounts for name lists (router strips PII, only id/first_name/last_name returned)
  try {
    const accounts = await getAccounts();
    state.names = accounts
      .filter(a => {
        if (!a.first_name && !a.last_name) return false;
        if ((a.last_name || '').includes('(test)')) return false;
        return true;
      })
      .map(a => `${a.first_name} ${a.last_name}`.trim())
      .filter(Boolean)
      .sort((a,b) => a.localeCompare(b));
  } catch { /* fall back to names derived from guide data */ }

  // Load audit state from datasetd
  try {
    state.audit = await getAllObjects('audit.ds');
  } catch { console.error('datasetd unavailable — audit data not loaded'); }

  if (!force) {
    const cached = sessionStorage.getItem(CONFIG.SESSION_KEY);
    if (cached) {
      try {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < CONFIG.SESSION_CACHE_TTL_MS) {
          processGuides(data);
          updateLastFetched(ts);
          renderCurrentView();
          return;
        }
        sessionStorage.removeItem(CONFIG.SESSION_KEY);
      } catch { /* fall through to fetch */ }
    }
  }

  showOverlay('loading');
  try {
    const guides = await getGuides({ status: 1, expand: 'pages,owner' });
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

//  Select option builders 
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

// View: Website Pages
function renderMyWebsitePages() {
  const f = state.wpFilters;
  const container = el('view-my-website-pages');

  // Remember the focused header search box so it survives the re-render each keystroke triggers
  const focused    = document.activeElement;
  const focusId    = focused && container.contains(focused) ? focused.id : null;
  const focusStart = focusId ? focused.selectionStart : null;
  const focusEnd   = focusId ? focused.selectionEnd   : null;

  // Empty expert/department fields read as the word "unassigned" so they can be searched for like any value
  const has = (val, q) => (String(val || '').toLowerCase() || 'unassigned').includes(q.trim().toLowerCase());

  const allPages = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId));
  let pages = allPages;
  if (f.page)       pages = pages.filter(p => has(p.pageLabel,  f.page));
  if (f.guide)      pages = pages.filter(p => has(p.guideTitle, f.guide));
  if (f.expert)     pages = pages.filter(p => has(p.expert,     f.expert));
  if (f.department) pages = pages.filter(p => has(p.department, f.department));
  // Same conditions pageLink() uses for the pills, so a toggle can't disagree with what's shown.
  if (f.hideHidden)     pages = pages.filter(p => String(p.enableDisplay) === '1');
  if (f.hideRedirected) pages = pages.filter(p => !p.pageRedirectUrl);

  const wpSort = state.wpSort;
  const sorted = [...pages].sort((a, b) => {
    let va, vb;
    if      (wpSort.col === 'guide')      { va = a.guideTitle  || ''; vb = b.guideTitle  || ''; }
    else if (wpSort.col === 'page')       { va = a.pageLabel   || ''; vb = b.pageLabel   || ''; }
    else if (wpSort.col === 'expert')     { va = a.expert      || ''; vb = b.expert      || ''; }
    else if (wpSort.col === 'department') { va = a.department  || ''; vb = b.department  || ''; }
    else if (wpSort.col === 'updated')    { va = a.updated     || ''; vb = b.updated     || ''; }
    const cmp = String(va).localeCompare(String(vb));
    return wpSort.dir === 'asc' ? cmp : -cmp;
  });

  const rowsHtml = sorted.length === 0
    ? `<tr><td colspan="8"><div class="empty-state">No pages found.</div></td></tr>`
    : sorted.map(p => {
        const dateClass = p.freshness === 'very-stale' ? 'date-very-stale'
                        : p.freshness === 'stale'      ? 'date-stale' : '';
        return `<tr>
          <td title="${esc(p.pageLabel)}">${pageLink(p)}</td>
          <td class="col-guide" title="${esc(p.guideTitle)}">${esc(p.guideTitle)}</td>
          <td><span class="${p.expert ? 'chip-assigned' : 'chip-unassigned'}">${esc(p.expert || 'unassigned')}</span></td>
          <td><span class="${p.department ? 'chip-assigned' : 'chip-unassigned'}">${esc(p.department || 'unassigned')}</span></td>
          <td class="${dateClass}">${esc(formatDate(p.updated))}</td>
          ${auditCells('page:' + p.pageId)}
        </tr>`;
      }).join('');

  const searchBox = (col, label) =>
    `<input class="header-search" type="search" id="wp-search-${col}" value="${esc(f[col])}" placeholder="Filter…" aria-label="Filter by ${label}">`;

  const toggle = (key, label) =>
    `<label class="filter-toggle">
      <input type="checkbox" id="wp-toggle-${key}" ${f[key] ? 'checked' : ''}>
      ${label}
    </label>`;

  // Only shown once something is actually filtered out — "287 of 287" is noise.
  const countLine = sorted.length === allPages.length ? '' :
    `<p class="filter-count">Showing ${sorted.length} of ${allPages.length} pages</p>`;

  container.innerHTML = `
    <div class="topbar topbar-stacked">
      <h1>Website Pages</h1>
      <div class="filter-toggles">
        <span class="filter-toggles-label">Filter:</span>
        ${toggle('hideHidden', 'Hidden pages')}
        ${toggle('hideRedirected', 'Redirected pages')}
      </div>
      ${countLine}
    </div>
    <div class="content">
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:22%"><col style="width:20%">
            <col style="width:10%"><col style="width:14%"><col style="width:13%">
            <col style="width:7%"><col style="width:7%"><col style="width:7%">
          </colgroup>
          <thead>
            <tr>
              <th scope="col"><span class="th-label">Page</span>${searchBox('page', 'page')}</th>
              <th scope="col"><span class="th-label">Guide</span>${searchBox('guide', 'guide')}</th>
              <th scope="col"><span class="th-label">Expert</span>${searchBox('expert', 'expert')}</th>
              <th scope="col"><span class="th-label">Department</span>${searchBox('department', 'department')}</th>
              ${sortTh('Last updated', 'updated', wpSort)}
              <th scope="col" class="col-audit-check">Links</th><th scope="col" class="col-audit-check">A11y</th><th scope="col" class="col-audit-check">Accuracy</th>
            </tr>
          </thead>
          <tbody id="wp-audit-tbody">${rowsHtml}</tbody>
          ${auditTfoot('wp-audit-tbody', 5)}
        </table>
      </div>
    </div>`;

  ['page', 'guide', 'expert', 'department'].forEach(col => {
    el(`wp-search-${col}`)?.addEventListener('input', e => {
      state.wpFilters[col] = e.target.value;
      renderMyWebsitePages();
    });
  });

  ['hideHidden', 'hideRedirected'].forEach(key => {
    el(`wp-toggle-${key}`)?.addEventListener('change', e => {
      state.wpFilters[key] = e.target.checked;
      renderMyWebsitePages();
    });
  });

  // Put the cursor back where it was so typing in a header filter isn't interrupted by the re-render
  if (focusId) {
    const box = el(focusId);
    if (box) {
      box.focus();
      if (focusStart != null && box.setSelectionRange) {
        try { box.setSelectionRange(focusStart, focusEnd); } catch (_) {}
      }
    }
  }

  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      state.wpSort = state.wpSort.col === col
        ? { col, dir: state.wpSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' };
      renderMyWebsitePages();
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

}

function renderMyResearchGuides() {
  const f = state.rgFilters;
  const container = el('view-my-research-guides');

  // Remember the focused header search box so it survives the re-render each keystroke triggers
  const focused    = document.activeElement;
  const focusId    = focused && container.contains(focused) ? focused.id : null;
  const focusStart = focusId ? focused.selectionStart : null;
  const focusEnd   = focusId ? focused.selectionEnd   : null;

  // Empty owner reads as the word "unassigned" so it can be searched for like any value
  const has = (val, q) => (String(val || '').toLowerCase() || 'unassigned').includes(q.trim().toLowerCase());

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
  let guides = Array.from(allGuideMap.values()).map(g => {
    const visiblePages = g.pages.filter(p => String(p.enableDisplay) === '1');
    return { ...g, pageCount: visiblePages.length, freshness: freshnessStatus(g.guideUpdated) };
  }).sort((a, b) => {
    const va = rgSort.col === 'updated' ? (a.guideUpdated || '') : (a.guideTitle || '');
    const vb = rgSort.col === 'updated' ? (b.guideUpdated || '') : (b.guideTitle || '');
    const cmp = String(va).localeCompare(String(vb));
    return rgSort.dir === 'asc' ? cmp : -cmp;
  });

  if (f.guide) guides = guides.filter(g => has(g.guideTitle, f.guide));
  if (f.owner) guides = guides.filter(g => has(g.guideOwner, f.owner));

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

  const searchBox = (col, label) =>
    `<input class="header-search" type="search" id="rg-search-${col}" value="${esc(f[col])}" placeholder="Filter…" aria-label="Filter by ${label}">`;

  container.innerHTML = `
    <div class="topbar"><h1>Research Guides</h1></div>
    <div class="content">
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:29%"><col style="width:18%"><col style="width:9%">
            <col style="width:23%">
            <col style="width:7%"><col style="width:7%"><col style="width:7%">
          </colgroup>
          <thead>
            <tr>
              <th scope="col"><span class="th-label">Guide</span>${searchBox('guide', 'guide')}</th>
              <th scope="col"><span class="th-label">Owner</span>${searchBox('owner', 'owner')}</th>
              <th scope="col" class="col-count"><span class="th-label">Pages</span></th>
              ${sortTh('Last updated', 'updated', rgSort)}
              <th scope="col" class="col-audit-check">Links</th><th scope="col" class="col-audit-check">A11y</th><th scope="col" class="col-audit-check">Accuracy</th>
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

  ['guide', 'owner'].forEach(col => {
    el(`rg-search-${col}`)?.addEventListener('input', e => {
      state.rgFilters[col] = e.target.value;
      renderMyResearchGuides();
    });
  });

  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      state.rgSort = state.rgSort.col === col
        ? { col, dir: state.rgSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' };
      renderMyResearchGuides();
    });
  });

  // Put the cursor back where it was so typing in a header filter isn't interrupted by the re-render
  if (focusId) {
    const box = el(focusId);
    if (box) {
      box.focus();
      if (focusStart != null && box.setSelectionRange) {
        try { box.setSelectionRange(focusStart, focusEnd); } catch (_) {}
      }
    }
  }
}


// View: Reports
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
    case 'hidden':      renderHiddenPanel(panel);      break;
    case 'unpublished': renderUnpublishedPanel(panel); break;
    case 'rg-stale':       renderRgStalePanel(panel);       break;
    case 'rg-hidden':      renderRgHiddenPanel(panel);      break;
    case 'rg-unpublished': renderRgUnpublishedPanel(panel); break;
  }
}

// Report: Stale content
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
  if (expert) data = data.filter(p => p.expert === expert);
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
         <colgroup><col style="width:26%"><col style="width:22%"><col style="width:32%"><col style="width:12%"><col style="width:8%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Expert</th><th>Last updated</th><th>Status</th></tr></thead>
         <tbody>${data.map(p=>`<tr>
           <td>${pageLink(p)}</td>
           <td class="col-guide">${esc(p.guideTitle)}</td>
           <td>${expertCell(p.expert)}</td>
           ${dateTd(p.updated)}
           <td>${freshnessBadge(p.freshness)}</td>
         </tr>`).join('')}</tbody>
       </table></div>`;

  el('r-stale-results').innerHTML = rowsHtml;
  el('r-stale-export')?.addEventListener('click', () => exportCSV('stale-content.csv', data, [
    { label:'Page',           get: p => p.pageLabel },
    { label:'Guide',          get: p => p.guideTitle },
    { label:'Expert', get: p => p.expert ?? '' },
    { label:'Last updated', get: p => formatDate(p.updated) },
    { label:'Days ago',     get: p => daysAgo(p.updated) },
    { label:'Status',       get: p => p.freshness },
    { label:'URL',          get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

// Report: Hidden pages
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

// Report: Stale research guides
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

// Report: Hidden pages in research guides
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

// Report: Unpublished website guides
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
    guides = await getGuides({ status: 0, expand: 'pages,owner' });
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

// Report: Unpublished research guides
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
    guides = await getGuides({ status: 0, expand: 'owner' });
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-state">Failed to load: ${esc(err.message)}</div>`;
    btn.textContent = 'Run report';
    btn.disabled = false;
    return;
  }

  btn.textContent = 'Run report';
  btn.disabled = false;

  guides = guides.filter(g => CONFIG.RESEARCH_GUIDE_GROUPS.includes(Number(g.group_id)));

  const rows = guides.map(g => {
    const guideTitle = decodeEntities(g.name || g.title || '(untitled)');
    const owner      = g.owner ? `${g.owner.first_name ?? ''} ${g.owner.last_name ?? ''}`.trim() : '—';
    const guideUrl   = g.friendly_url || g.url || null;
    const guideHtml  = guideUrl
      ? `<a class="page-link" href="${esc(guideUrl)}" target="_blank" rel="noopener">${esc(guideTitle)}</a>`
      : esc(guideTitle);
    return { guideTitle, guideUrl, owner, updated: formatDate(g.updated), guideHtml };
  });
  rows.sort((a, b) => a.guideTitle.localeCompare(b.guideTitle));

  if (!rows.length) {
    resultsEl.innerHTML = `<div class="empty-state">No unpublished guides found.</div>`;
    return;
  }

  resultsEl.innerHTML = `
    <div class="result-actions">
      <span class="result-count">${rows.length} result${rows.length !== 1 ? 's' : ''}</span>
      <button class="btn-export" id="r-rgu-export">Export CSV</button>
    </div>
    <div class="table-wrap"><table>
      <colgroup><col style="width:50%"><col style="width:28%"><col style="width:22%"></colgroup>
      <thead><tr><th>Guide</th><th>Owner</th><th>Last updated</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.guideHtml}</td>
        <td class="col-guide">${esc(r.owner)}</td>
        <td>${esc(r.updated)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  el('r-rgu-export')?.addEventListener('click', () => exportCSV('unpublished-research-guides.csv', rows, [
    { label:'Guide',        get: r => r.guideTitle },
    { label:'Owner',        get: r => r.owner },
    { label:'Last updated', get: r => r.updated },
    { label:'URL',          get: r => r.guideUrl ?? '' },
  ]));
}

function emptyPromptHtml() {
  return `<div class="empty-state">Select a report above and run it to see results.</div>`;
}

// View: Assign Roles
function renderManageStewards() {
  const f = state.manageFilters;
  const container = el('view-manage-stewards');

  // Remember the focused header search box so it survives the re-render each keystroke triggers
  const focused    = document.activeElement;
  const focusId    = focused && container.contains(focused) ? focused.id : null;
  const focusStart = focusId ? focused.selectionStart : null;
  const focusEnd   = focusId ? focused.selectionEnd   : null;

  // Empty expert/department fields read as the word "unassigned" so they can be searched for like any value
  const has = (val, q) => (String(val || '').toLowerCase() || 'unassigned').includes(q.trim().toLowerCase());

  let filtered = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId));
  if (f.page)       filtered = filtered.filter(p => has(p.pageLabel,  f.page));
  if (f.guide)      filtered = filtered.filter(p => has(p.guideTitle, f.guide));
  if (f.expert)     filtered = filtered.filter(p => has(p.expert,     f.expert));
  if (f.department) filtered = filtered.filter(p => has(p.department, f.department));
  // No interactive sort on this view; keep a stable read order by guide then page
  filtered = [...filtered].sort((a, b) =>
    (a.guideTitle || '').localeCompare(b.guideTitle || '') ||
    (a.pageLabel  || '').localeCompare(b.pageLabel  || ''));

  const nameListId = 'steward-names-list';
  const nameListHtml = `
    <datalist id="${nameListId}">
      ${state.names.map(n => `<option value="${esc(n)}">`).join('')}
    </datalist>`;

  const rowsHtml = filtered.length === 0
    ? `<tr><td colspan="4"><div class="empty-state">No pages match the current filters.</div></td></tr>`
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
            <select class="steward-input" data-field="department" data-page-id="${p.pageId}"
              data-empty="${!p.department}"
              aria-label="Department for ${esc(p.pageLabel)}">
              <option value="">unassigned</option>
              ${CONFIG.DEPARTMENTS.map(d => `<option value="${esc(d)}" ${p.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
            </select>
          </td>
        </tr>`).join('');

  const searchBox = (col, label) =>
    `<input class="header-search" type="search" id="ms-search-${col}" value="${esc(f[col])}" placeholder="Filter…" aria-label="Filter by ${label}">`;

  container.innerHTML = `
    ${nameListHtml}
    <div class="topbar">
      <h1>Assign Roles</h1>
    </div>
    <div class="content">
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:20%"><col style="width:24%">
            <col style="width:30%"><col style="width:26%">
          </colgroup>
          <thead>
            <tr>
              <th scope="col"><span class="th-label">Page</span>${searchBox('page', 'page')}</th>
              <th scope="col"><span class="th-label">Guide</span>${searchBox('guide', 'guide')}</th>
              <th scope="col"><span class="th-label">Expert</span>${searchBox('expert', 'expert')}</th>
              <th scope="col"><span class="th-label">Department</span>${searchBox('department', 'department')}</th>
            </tr>
          </thead>
          <tbody id="ms-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;

  ['page', 'guide', 'expert', 'department'].forEach(col => {
    el(`ms-search-${col}`)?.addEventListener('input', e => {
      state.manageFilters[col] = e.target.value;
      renderManageStewards();
    });
  });

  // Put the cursor back where it was so typing in a header filter isn't interrupted by the re-render
  if (focusId) {
    const box = el(focusId);
    if (box) {
      box.focus();
      if (focusStart != null && box.setSelectionRange) {
        try { box.setSelectionRange(focusStart, focusEnd); } catch (_) {}
      }
    }
  }

  // Inline edit — save to datasetd on change
  el('ms-tbody')?.addEventListener('change', e => {
    const input = e.target.closest('.steward-input');
    if (!input) return;
    const pageId = input.dataset.pageId;
    const field  = input.dataset.field;
    const value  = input.value.trim();
    if (input.tagName === 'SELECT') input.dataset.empty = String(!value);

    const isNewRecord = !state.stewardship[pageId];
    if (isNewRecord) state.stewardship[pageId] = { expert: '', department: '' };
    state.stewardship[pageId][field] = value;

    // Keep page record in sync so other views reflect the change immediately
    const page = state.pages.find(p => String(p.pageId) === String(pageId));
    if (page) {
      if (field === 'expert')     page.expert     = value || null;
      if (field === 'department') page.department = value || null;
    }

    const entry = state.stewardship[pageId];
    const payload = { pageId, expert: entry.expert || '', department: entry.department || '', updatedBy: CONFIG.currentUser };
    // PUT silently no-ops if the record doesn't exist yet — use POST to create it.
    if (isNewRecord) postObject('stewardship.ds', pageId, payload);
    else             putObject('stewardship.ds', pageId, payload);
  });
}


// CSV export
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

// Navigation
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

// Init
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
