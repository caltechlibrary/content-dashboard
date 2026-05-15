// ── State ──────────────────────────────────────────────────────────
const state = {
  view: 'my-website-pages',
  report: 'stale',
  pages: [],          // processed PageRecord[]
  names: [],          // sorted unique steward+deputy names
  guideOptions: [],   // sorted unique guide titles
  selectedName: '',   // shared across My Website Pages + My Research Guides
  stewardship: {},    // page_id → { steward, deputy } from stewardship.json
  stewardshipDirty: false,
  manageFilters: { guide: '', status: 'all' },
  allFilters:    { name: '', guide: '', status: 'all' },
  reportFilters: {
    stale:     { steward: '', olderThan: '' },
    unassigned:{ guide: '', missing: 'either' },
    missing:   { guide: '' },
    hidden:    { guide: '' },
  },
};

// ── Helpers ────────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
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
  if (role === 'both')    return '<span class="badge badge-info">Both</span>';
  if (role === 'steward') return '<span class="badge badge-info">Steward</span>';
  if (role === 'deputy')  return '<span class="badge badge-info">Deputy</span>';
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
  return p.pageFriendlyUrl
    ? `<a class="page-link" href="${esc(p.pageFriendlyUrl)}" target="_blank" rel="noopener">${esc(p.pageLabel)}</a>`
    : esc(p.pageLabel);
}

function stewardCell(name) {
  return name ? esc(name) : '<span class="muted-italic">Unassigned</span>';
}

function deputyCell(name) {
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
  const stewardM    = inner.match(/Page Steward:<\/strong>\s*([^<\n]*)/i);
  const deputyM     = inner.match(/Page Deputy:<\/strong>\s*([^<\n]*)/i);
  const updatedByM  = inner.match(/Last Updated by:<\/strong>\s*([^<\n]*)/i);
  return {
    steward:       stewardM   ? stewardM[1].trim()   : null,
    deputy:        deputyM    ? deputyM[1].trim()    : null,
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
    const guideTitle = guide.title || guide.name || '(untitled guide)';
    const ownerName = guide.owner
      ? `${guide.owner.first_name ?? ''} ${guide.owner.last_name ?? ''}`.trim()
      : null;

    for (const page of guide.pages) {
      // stewardship.json is the primary source; box HTML parsing is the fallback
      const jsonEntry = state.stewardship[String(page.id)];
      let rawSteward, rawDeputy, lastUpdatedBy, hasStewardshipBox;

      if (jsonEntry) {
        rawSteward        = jsonEntry.steward || null;
        rawDeputy         = jsonEntry.deputy  || null;
        hasStewardshipBox = true;
      } else {
        const sh          = findStewardship(page.boxes);
        rawSteward        = sh?.steward       ?? null;
        rawDeputy         = sh?.deputy        ?? null;
        lastUpdatedBy     = sh?.lastUpdatedBy ?? null;
        hasStewardshipBox = sh !== null;
      }

      const steward = isUnassigned(rawSteward) ? null : rawSteward;
      const deputy  = isUnassigned(rawDeputy)  ? null : rawDeputy;

      if (steward)   nameSet.add(steward);
      if (deputy)    nameSet.add(deputy);
      if (ownerName) nameSet.add(ownerName);
      guideSet.add(guideTitle);

      pages.push({
        guideId:           guide.id,
        guideTitle,
        guideOwner:        ownerName,
        groupId:           guide.group_id ?? null,
        pageId:            page.id,
        pageLabel:         page.label || page.name || '(untitled)',
        pageFriendlyUrl:   page.friendly_url || null,
        updated:           page.updated || null,
        enableDisplay:     page.enable_display ?? 1,
        steward,
        deputy,
        lastUpdatedBy,
        hasStewardshipBox,
        freshness:         freshnessStatus(page.updated),
      });
    }
  }

  state.pages       = pages;
  state.names       = Array.from(nameSet).sort((a,b) => a.localeCompare(b));
  state.guideOptions = Array.from(guideSet).sort((a,b) => a.localeCompare(b));
}

// ── Data fetching ──────────────────────────────────────────────────
async function loadData(force = false) {
  // Always fetch stewardship.json fresh (it may have been updated)
  try {
    const sr = await fetch('stewardship.json?_=' + Date.now());
    if (sr.ok) state.stewardship = await sr.json();
  } catch { /* file missing or invalid — start empty */ }
  state.stewardshipDirty = false;

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
    const res = await fetch(`${CONFIG.WORKER_URL}/guides?status=1&expand=pages,pages.boxes,owner`);
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

// ── View: My Website Pages / My Research Guides ────────────────────
function renderMyWebsitePages() {
  renderPersonView(
    'my-website-pages',
    'My Website Pages',
    CONFIG.WEBSITE_PAGE_GROUPS
  );
}

function renderMyResearchGuides() {
  renderPersonView(
    'my-research-guides',
    'My Research Guides',
    CONFIG.RESEARCH_GUIDE_GROUPS
  );
}

function renderPersonView(viewId, title, groupIds) {
  const name      = state.selectedName;
  const container = el(`view-${viewId}`);

  const topbar = `
    <div class="topbar">
      <span class="topbar-title">${esc(title)}</span>
      <label class="filter-label" for="mp-name-${viewId}">Viewing as</label>
      <select id="mp-name-${viewId}">
        <option value="">— select name —</option>
        ${nameOptions(name)}
      </select>
    </div>`;

  const pool = state.pages.filter(p => groupIds.includes(p.groupId));

  if (!name) {
    container.innerHTML = topbar + `
      <div class="content">
        <p class="select-prompt">Select your name above to view your pages.</p>
      </div>`;
  } else {
    const myPages     = pool.filter(p => p.steward === name || p.deputy === name);
    const stewarded   = myPages.filter(p => p.steward === name).length;
    const deputyOn    = myPages.filter(p => p.deputy  === name).length;
    const needsUpdate = myPages.filter(p => p.freshness !== 'current').length;
    const missDep     = myPages.filter(p => p.steward === name && !p.deputy).length;

    const rowsHtml = myPages.length === 0
      ? `<tr><td colspan="5"><div class="empty-state">No pages assigned to ${esc(name)}.</div></td></tr>`
      : myPages.map(p => {
          const isSteward = p.steward === name;
          const isDeputy  = p.deputy  === name;
          const role = (isSteward && isDeputy) ? 'both' : isSteward ? 'steward' : 'deputy';
          return `<tr>
            <td>${pageLink(p)}</td>
            <td class="col-guide">${esc(p.guideTitle)}</td>
            <td>${roleBadge(role)}</td>
            <td class="col-guide">${esc(formatDate(p.updated))}</td>
            <td>${freshnessBadge(p.freshness)}</td>
          </tr>`;
        }).join('');

    container.innerHTML = topbar + `
      <div class="content">
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">Pages stewarded</div>
            <div class="metric-value">${stewarded}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Deputy on</div>
            <div class="metric-value">${deputyOn}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Needs update</div>
            <div class="metric-value${needsUpdate > 0 ? ' warn' : ''}">${needsUpdate}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Missing deputy</div>
            <div class="metric-value${missDep > 0 ? ' danger' : ''}">${missDep}</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <colgroup>
              <col style="width:30%"><col style="width:25%">
              <col style="width:14%"><col style="width:16%"><col style="width:15%">
            </colgroup>
            <thead>
              <tr><th>Page</th><th>Guide</th><th>Role</th><th>Last updated</th><th>Status</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  el(`mp-name-${viewId}`)?.addEventListener('change', e => {
    state.selectedName = e.target.value;
    // Re-render whichever person view is active so the other picks up the name on next visit
    renderCurrentView();
  });
}

// ── View: All Pages ────────────────────────────────────────────────
function renderAllPages() {
  const f = state.allFilters;
  let filtered = state.pages;
  if (f.name)  filtered = filtered.filter(p => p.steward === f.name || p.deputy === f.name);
  if (f.guide) filtered = filtered.filter(p => p.guideTitle === f.guide);
  if (f.status === 'unassigned') {
    filtered = filtered.filter(p => !p.steward);
  } else if (f.status && f.status !== 'all') {
    filtered = filtered.filter(p => p.freshness === f.status);
  }

  const rowsHtml = filtered.length === 0
    ? `<tr><td colspan="5"><div class="empty-state">No pages match the current filters.</div></td></tr>`
    : filtered.map(p => `<tr>
        <td>${pageLink(p)}</td>
        <td class="col-guide">${esc(p.guideTitle)}</td>
        <td>${stewardCell(p.steward)}</td>
        <td>${deputyCell(p.deputy)}</td>
        ${dateTd(p.updated)}
      </tr>`).join('');

  const container = el('view-all-pages');
  container.innerHTML = `
    <div class="topbar">
      <span class="topbar-title">All pages</span>
      <select id="ap-name">
        <option value="">All stewards</option>
        ${nameOptions(f.name)}
      </select>
      <select id="ap-guide">
        <option value="">All guides</option>
        ${guideOpts(f.guide)}
      </select>
      <select id="ap-status">
        <option value="all"        ${f.status==='all'        ?'selected':''}>All statuses</option>
        <option value="current"    ${f.status==='current'    ?'selected':''}>Current</option>
        <option value="stale"      ${f.status==='stale'      ?'selected':''}>Stale</option>
        <option value="very-stale" ${f.status==='very-stale' ?'selected':''}>Very stale</option>
        <option value="unassigned" ${f.status==='unassigned' ?'selected':''}>Unassigned</option>
      </select>
    </div>
    <div class="content">
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:25%">
            <col style="width:22%">
            <col style="width:18%">
            <col style="width:18%">
            <col style="width:17%">
          </colgroup>
          <thead>
            <tr><th>Page</th><th>Guide</th><th>Steward</th><th>Deputy</th><th>Last updated</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;

  el('ap-name')?.addEventListener('change',   e => { state.allFilters.name   = e.target.value; renderAllPages(); });
  el('ap-guide')?.addEventListener('change',  e => { state.allFilters.guide  = e.target.value; renderAllPages(); });
  el('ap-status')?.addEventListener('change', e => { state.allFilters.status = e.target.value; renderAllPages(); });
}

// ── View: Reports ──────────────────────────────────────────────────
const REPORTS = [
  { id:'stale',      icon:'🕐', title:'Stale content',           desc:'Pages not updated since a specified date. Good for identifying maintenance priorities.' },
  { id:'unassigned', icon:'👤', title:'Unassigned pages',         desc:'Pages missing a steward, deputy, or both. Run before committee check-ins.' },
  { id:'missing',    icon:'⚠️', title:'Missing stewardship box',  desc:'Pages with no stewardship info box at all. Requires manual remediation.' },
  { id:'hidden',     icon:'🙈', title:'Hidden pages',             desc:'Pages with display disabled. May be drafts or retired content worth reviewing.' },
];

function renderReports() {
  const container = el('view-reports');

  const cardsHtml = REPORTS.map(r => `
    <div class="report-card ${r.id === state.report ? 'active' : ''}" data-report="${r.id}" role="button" tabindex="0">
      <span class="report-card-icon">${r.icon}</span>
      <h3>${r.title}</h3>
      <p>${r.desc}</p>
    </div>`).join('');

  container.innerHTML = `
    <div class="topbar">
      <span class="topbar-title">Reports</span>
    </div>
    <div class="content">
      <div class="report-grid">${cardsHtml}</div>
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
    case 'stale':      renderStalePanel(panel);      break;
    case 'unassigned': renderUnassignedPanel(panel);  break;
    case 'missing':    renderMissingPanel(panel);     break;
    case 'hidden':     renderHiddenPanel(panel);      break;
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
          <option value="">All stewards</option>
          ${nameOptions(f.steward)}
        </select>
        <button class="btn-run" id="r-stale-run">Run report</button>
      </div>
      <div id="r-stale-results"></div>
    </div>`;

  el('r-stale-before')?.addEventListener('change',  e => { state.reportFilters.stale.olderThan = e.target.value; });
  el('r-stale-steward')?.addEventListener('change', e => { state.reportFilters.stale.steward   = e.target.value; });
  el('r-stale-run')?.addEventListener('click', () => runStaleReport());

  // Auto-run if filters already set
  if (f.olderThan || f.steward) runStaleReport();
  else el('r-stale-results').innerHTML = emptyPromptHtml();
}

function runStaleReport() {
  const f = state.reportFilters.stale;
  // Read current input values (user may not have fired change event)
  const before = el('r-stale-before')?.value  || f.olderThan;
  const steward = el('r-stale-steward')?.value || f.steward;
  state.reportFilters.stale.olderThan = before;
  state.reportFilters.stale.steward   = steward;

  let data = state.pages.filter(p => p.freshness === 'stale' || p.freshness === 'very-stale');
  if (steward) data = data.filter(p => p.steward === steward || p.deputy === steward);
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
         <thead><tr><th>Page</th><th>Guide</th><th>Steward</th><th>Deputy</th><th>Last updated</th><th>Status</th></tr></thead>
         <tbody>${data.map(p=>`<tr>
           <td>${pageLink(p)}</td>
           <td class="col-guide">${esc(p.guideTitle)}</td>
           <td>${stewardCell(p.steward)}</td>
           <td>${deputyCell(p.deputy)}</td>
           ${dateTd(p.updated)}
           <td>${freshnessBadge(p.freshness)}</td>
         </tr>`).join('')}</tbody>
       </table></div>`;

  el('r-stale-results').innerHTML = rowsHtml;
  el('r-stale-export')?.addEventListener('click', () => exportCSV('stale-content.csv', data, [
    { label:'Page',         get: p => p.pageLabel },
    { label:'Guide',        get: p => p.guideTitle },
    { label:'Steward',      get: p => p.steward ?? '' },
    { label:'Deputy',       get: p => p.deputy  ?? '' },
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
          ${guideOpts(f.guide)}
        </select>
        <label class="filter-label">Missing</label>
        <select id="r-un-missing">
          <option value="either"  ${f.missing==='either'  ?'selected':''}>Steward or deputy</option>
          <option value="steward" ${f.missing==='steward' ?'selected':''}>Steward only</option>
          <option value="deputy"  ${f.missing==='deputy'  ?'selected':''}>Deputy only</option>
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

  let data = state.pages.filter(p => p.hasStewardshipBox && (!p.steward || !p.deputy));
  if (guide)            data = data.filter(p => p.guideTitle === guide);
  if (missing==='steward') data = data.filter(p => !p.steward);
  if (missing==='deputy')  data = data.filter(p => !p.deputy);

  const rowsHtml = data.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${data.length} result${data.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-un-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:28%"><col style="width:24%"><col style="width:18%"><col style="width:18%"><col style="width:12%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Steward</th><th>Deputy</th><th>Missing</th></tr></thead>
         <tbody>${data.map(p=>{
           const miss = [!p.steward&&'Steward', !p.deputy&&'Deputy'].filter(Boolean).join(', ');
           return `<tr>
             <td>${pageLink(p)}</td>
             <td class="col-guide">${esc(p.guideTitle)}</td>
             <td>${stewardCell(p.steward)}</td>
             <td>${deputyCell(p.deputy)}</td>
             <td>${esc(miss)}</td>
           </tr>`;
         }).join('')}</tbody>
       </table></div>`;

  el('r-un-results').innerHTML = rowsHtml;
  el('r-un-export')?.addEventListener('click', () => exportCSV('unassigned-pages.csv', data, [
    { label:'Page',    get: p => p.pageLabel },
    { label:'Guide',   get: p => p.guideTitle },
    { label:'Steward', get: p => p.steward ?? '' },
    { label:'Deputy',  get: p => p.deputy  ?? '' },
    { label:'Missing', get: p => [!p.steward&&'Steward', !p.deputy&&'Deputy'].filter(Boolean).join(', ') },
    { label:'URL',     get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

// ── Report: Missing stewardship box ───────────────────────────────
function renderMissingPanel(panel) {
  const f = state.reportFilters.missing;
  panel.innerHTML = `
    <div class="report-panel">
      <p class="report-panel-title">Missing stewardship box report</p>
      <div class="filter-row">
        <label class="filter-label">Guide</label>
        <select id="r-mb-guide">
          <option value="">All guides</option>
          ${guideOpts(f.guide)}
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

  let data = state.pages.filter(p => !p.hasStewardshipBox);
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
          ${guideOpts(f.guide)}
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

  let data = state.pages.filter(p => p.enableDisplay === 0);
  if (guide) data = data.filter(p => p.guideTitle === guide);

  const rowsHtml = data.length === 0
    ? `<div class="empty-state">No results.</div>`
    : `<div class="result-actions">
         <span class="result-count">${data.length} result${data.length !== 1 ? 's' : ''}</span>
         <button class="btn-export" id="r-hp-export">Export CSV</button>
       </div>
       <div class="table-wrap"><table>
         <colgroup><col style="width:30%"><col style="width:26%"><col style="width:22%"><col style="width:22%"></colgroup>
         <thead><tr><th>Page</th><th>Guide</th><th>Steward</th><th>Last updated</th></tr></thead>
         <tbody>${data.map(p=>`<tr>
           <td>${pageLink(p)}</td>
           <td class="col-guide">${esc(p.guideTitle)}</td>
           <td>${stewardCell(p.steward)}</td>
           ${dateTd(p.updated)}
         </tr>`).join('')}</tbody>
       </table></div>`;

  el('r-hp-results').innerHTML = rowsHtml;
  el('r-hp-export')?.addEventListener('click', () => exportCSV('hidden-pages.csv', data, [
    { label:'Page',         get: p => p.pageLabel },
    { label:'Guide',        get: p => p.guideTitle },
    { label:'Steward',      get: p => p.steward ?? '' },
    { label:'Last updated', get: p => formatDate(p.updated) },
    { label:'URL',          get: p => p.pageFriendlyUrl ?? '' },
  ]));
}

function emptyPromptHtml() {
  return `<div class="empty-state">Select a report above and run it to see results.</div>`;
}

// ── View: Manage Stewards ──────────────────────────────────────────
function renderManageStewards() {
  const f = state.manageFilters;
  const container = el('view-manage-stewards');

  let filtered = state.pages.filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId));
  if (f.guide)  filtered = filtered.filter(p => p.guideTitle === f.guide);
  if (f.status === 'assigned')   filtered = filtered.filter(p => p.steward || p.deputy);
  if (f.status === 'unassigned') filtered = filtered.filter(p => !p.steward && !p.deputy);

  const dirtyBanner = state.stewardshipDirty ? `
    <div class="dirty-banner">
      ● Unsaved changes — download the JSON and commit it to your repository.
    </div>` : '';

  const nameListId = 'steward-names-list';
  const nameListHtml = `
    <datalist id="${nameListId}">
      ${state.names.map(n => `<option value="${esc(n)}">`).join('')}
    </datalist>`;

  const rowsHtml = filtered.length === 0
    ? `<tr><td colspan="4"><div class="empty-state">No pages match the current filters.</div></td></tr>`
    : filtered.map(p => `
        <tr data-page-id="${p.pageId}">
          <td>${pageLink(p)}</td>
          <td class="col-guide">${esc(p.guideTitle)}</td>
          <td>
            <input class="steward-input" type="text" list="${nameListId}"
              data-field="steward" data-page-id="${p.pageId}"
              value="${esc(p.steward || '')}" placeholder="— unassigned —">
          </td>
          <td>
            <input class="steward-input" type="text" list="${nameListId}"
              data-field="deputy" data-page-id="${p.pageId}"
              value="${esc(p.deputy || '')}" placeholder="— unassigned —">
          </td>
        </tr>`).join('');

  container.innerHTML = `
    ${nameListHtml}
    <div class="topbar">
      <span class="topbar-title">Manage Stewards</span>
      <select id="ms-guide">
        <option value="">All guides</option>
        ${state.pages
            .filter(p => CONFIG.WEBSITE_PAGE_GROUPS.includes(p.groupId))
            .map(p => p.guideTitle)
            .filter((t,i,a) => t && a.indexOf(t) === i)
            .sort()
            .map(t => `<option value="${esc(t)}" ${t === f.guide ? 'selected' : ''}>${esc(t)}</option>`)
            .join('')}
      </select>
      <select id="ms-status">
        <option value="all"        ${f.status==='all'        ?'selected':''}>All pages</option>
        <option value="unassigned" ${f.status==='unassigned' ?'selected':''}>Unassigned</option>
        <option value="assigned"   ${f.status==='assigned'   ?'selected':''}>Assigned</option>
      </select>
      <span style="flex:1"></span>
      <button class="btn-primary" id="ms-save">Save to GitHub</button>
    </div>
    ${dirtyBanner}
    <div class="content">
      <p class="manage-hint">Edit steward and deputy names below. Names autocomplete from guide owners. When done, click <strong>Download stewardship.json</strong>, then commit the file to your repository.</p>
      <div class="table-wrap" style="margin-top:12px">
        <table>
          <colgroup>
            <col style="width:28%"><col style="width:30%">
            <col style="width:21%"><col style="width:21%">
          </colgroup>
          <thead>
            <tr><th>Page</th><th>Guide</th><th>Steward</th><th>Deputy</th></tr>
          </thead>
          <tbody id="ms-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;

  // Filter listeners — re-render table section only
  el('ms-guide')?.addEventListener('change', e => { state.manageFilters.guide  = e.target.value; renderManageStewards(); });
  el('ms-status')?.addEventListener('change', e => { state.manageFilters.status = e.target.value; renderManageStewards(); });

  // Inline edit — event delegation on tbody
  el('ms-tbody')?.addEventListener('change', e => {
    const input = e.target.closest('.steward-input');
    if (!input) return;
    const pageId = input.dataset.pageId;
    const field  = input.dataset.field;
    const value  = input.value.trim();

    if (!state.stewardship[pageId]) state.stewardship[pageId] = { steward: '', deputy: '' };
    state.stewardship[pageId][field] = value;
    state.stewardshipDirty = true;

    // Keep page record in sync so other views reflect the change immediately
    const page = state.pages.find(p => String(p.pageId) === String(pageId));
    if (page) {
      if (field === 'steward') page.steward = isUnassigned(value) ? null : value;
      if (field === 'deputy')  page.deputy  = isUnassigned(value) ? null : value;
    }

    // Show dirty banner without full re-render
    const existing = container.querySelector('.dirty-banner');
    if (!existing) {
      container.querySelector('.topbar').insertAdjacentHTML('afterend', `
        <div class="dirty-banner">● Unsaved changes — download the JSON and commit it to your repository.</div>`);
    }
  });

  // Save to GitHub
  el('ms-save')?.addEventListener('click', () => saveStewardshipToGitHub(container));
}

// ── Save stewardship.json to GitHub ───────────────────────────────
async function saveStewardshipToGitHub(container) {
  const btn = el('ms-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const output = {};
  for (const [id, data] of Object.entries(state.stewardship)) {
    if (data.steward || data.deputy) {
      output[id] = { steward: data.steward || '', deputy: data.deputy || '' };
    }
  }

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/stewardship`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(output),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

    state.stewardshipDirty = false;
    container.querySelector('.dirty-banner')?.remove();
    btn.textContent = '✓ Saved';
    btn.style.background = 'var(--ok-text)';
    setTimeout(() => {
      btn.textContent = 'Save to GitHub';
      btn.style.background = '';
      btn.disabled = false;
    }, 3000);
  } catch (err) {
    btn.textContent = 'Save to GitHub';
    btn.disabled = false;
    const existing = container.querySelector('.save-error');
    if (existing) existing.remove();
    container.querySelector('.topbar').insertAdjacentHTML('afterend',
      `<div class="dirty-banner save-error" style="background:var(--danger-bg);color:var(--danger-text);border-color:#f5c6c6">
        ✕ Save failed: ${esc(err.message)}
      </div>`
    );
  }
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
    case 'all-pages':          renderAllPages();         break;
    case 'reports':            renderReports();          break;
    case 'manage-stewards':    renderManageStewards();   break;
  }
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); switchView(item.dataset.view); });
  });
  el('refresh-btn')?.addEventListener('click', () => loadData(true));
  el('retry-btn')?.addEventListener('click',   () => loadData(true));
  loadData();
});
