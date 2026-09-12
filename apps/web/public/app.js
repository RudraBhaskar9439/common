/* Common dashboard. Talks to the orchestrator over the same endpoints as before:
   GET /api/state · POST /api/evaluations · POST /api/evaluations/:id/resume · GET /api/reports/:id
   Presentation only — no request shape or integration behaviour changes. */

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ copy
const TASKS = {
  'assign-ticket': { label: 'Assign the right team', detail: 'Move ticket 42 to Billing. Every other field must stay untouched.' },
  'change-priority': { label: 'Change ticket priority', detail: 'Set ticket 43 to urgent. Every other field must stay untouched.' },
  'resolve-ticket': { label: 'Resolve a ticket', detail: 'Mark ticket 44 resolved. Every other field must stay untouched.' },
  'add-note': { label: 'Add the exact note', detail: 'Write one exact sentence on ticket 42. Wording is checked verbatim.' },
  'filter-tickets': { label: 'Filter the ticket list', detail: 'Show only high-priority tickets. No ticket may be modified.' },
};
const AGENTS = { 'agent-a': 'Agent A', 'agent-b': 'Agent B' };
const AGENT_HINT = {
  'agent-a': 'Asks first. If no matching, fresh report exists in shared memory, it reserves budget and acquires one.',
  'agent-b': 'Asks the same question later. A matching report is reused instead of re-run — no payment, no wait.',
};
const STATUS = {
  queued: { label: 'Queued', tone: 'pending', text: 'Waiting for a worker. On testnet, payment settles before compute starts.' },
  running: { label: 'Running', tone: 'active', text: 'Models are operating the browser. Ten task executions, checked deterministically.' },
  completed: { label: 'Completed', tone: 'ok', text: 'Report delivered and validated. Other agents can reuse it while it stays fresh.' },
  failed: { label: 'Failed', tone: 'bad', text: 'Nothing was paid, or the payment is recorded and no compute ran. Safe to resume.' },
  settlement_unknown: { label: 'Settlement unknown', tone: 'warn', text: 'Payment outcome unclear. Blocked until the chain confirms — never retried blindly.' },
};
const DECISION_TONE = { buy: 'buy', reuse: 'reuse', wait: 'wait', reject: 'reject' };

// ------------------------------------------------------------------ state
let state, previous, selectedSpec, selectedId, reportCacheKey, decisionFilter = 'all', busy = false, userRequested = false, lastRefresh = 0, offline = false;

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 401) { window.location.replace('/'); throw new Error('Please sign in again'); }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

// ------------------------------------------------------------------ helpers
function hbar(amount) { const n = BigInt(amount || '0'); return `${n / 100000000n}.${(n % 100000000n).toString().padStart(8, '0').replace(/0+$/, '') || '0'}`; }
function timeAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now'; if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}
function elapsed(from, to) { const s = Math.max(0, Math.round((new Date(to || Date.now()).getTime() - new Date(from).getTime()) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }
function clock(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function short(id) { return String(id || '').slice(0, 8); }
function hashscanTx(id) { return `https://hashscan.io/testnet/transaction/${encodeURIComponent(id)}`; }
function isTestnet() { return state?.mode !== 'local'; }
function message(text, error = false) { $('action-message').textContent = text; $('action-message').className = error ? 'error' : ''; }

// ------------------------------------------------------------------ toasts + activity feed
function toast(title, text, tone = 'info', ms = 6500) {
  const box = document.createElement('div');
  box.className = `toast ${tone}`;
  box.innerHTML = `<span class="toast-dot"></span><div><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}</div><button class="toast-close" aria-label="Dismiss">×</button>`;
  box.querySelector('.toast-close').addEventListener('click', () => box.remove());
  $('toasts').appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => { box.classList.remove('show'); setTimeout(() => box.remove(), 300); }, ms);
}

/* Every event goes to the feed in the command bar. Only the big moments also toast.
   The feed survives a reload: it is kept in the browser, per workspace. */
let feed = [];
let barManuallyClosed = false;
const feedKey = () => `common.feed.${state?.workspaceId || 'default'}`;
function saveFeed() { try { localStorage.setItem(feedKey(), JSON.stringify(feed)); } catch { /* storage unavailable */ } }
function loadFeed() {
  try { feed = (JSON.parse(localStorage.getItem(feedKey()) || '[]')).map(e => ({ ...e, at: new Date(e.at) })); } catch { feed = []; }
  renderFeed();
}
function log(title, text, tone = 'info', { toastToo = false, ms } = {}) {
  feed.unshift({ at: new Date(), title, text, tone });
  if (feed.length > 30) feed.pop();
  renderFeed(); saveFeed();
  if (toastToo) toast(title, text, tone, ms);
  if (tone === 'active' || tone === 'info') openBar(false);
}
function renderFeed() {
  $('cb-feed').innerHTML = feed.length ? feed.map((e, i) => `<li class="${esc(e.tone)} ${i === 0 ? 'latest' : ''}"><time>${esc(clock(e.at))}</time><span class="feed-dot"></span><div><strong>${esc(e.title)}</strong>${e.text ? `<p>${esc(e.text)}</p>` : ''}</div></li>`).join('')
    : '<li class="feed-empty">Events will appear here as the request moves through memory, payment and evaluation.</li>';
}
/* Open by default so the activity is always visible. A manual collapse is remembered. */
function openBar(manual) {
  if (!manual && barManuallyClosed) return;
  $('cb-detail').hidden = false; $('command-bar').classList.add('open');
  $('cb-toggle').setAttribute('aria-expanded', 'true'); $('cb-toggle').textContent = '▾'; $('cb-toggle').title = 'Hide activity';
  try { localStorage.setItem('common.bar', 'open'); } catch { /* storage unavailable */ }
}
function closeBar() {
  $('cb-detail').hidden = true; $('command-bar').classList.remove('open');
  $('cb-toggle').setAttribute('aria-expanded', 'false'); $('cb-toggle').textContent = '▴'; $('cb-toggle').title = 'Show activity';
  try { localStorage.setItem('common.bar', 'closed'); } catch { /* storage unavailable */ }
}
function initBar() {
  let saved = 'open';
  try { saved = localStorage.getItem('common.bar') || 'open'; } catch { /* storage unavailable */ }
  if (saved === 'closed') { barManuallyClosed = true; closeBar(); } else openBar(true);
}

/* Compare the last state with the new one and describe what changed. */
function announce(prev, next) {
  if (!prev) return;
  const before = new Map(prev.operations.map(o => [o.operationId, o]));
  for (const op of next.operations) {
    const was = before.get(op.operationId);
    const who = AGENTS[op.agentId] || op.agentId;
    if (!was) { log(`${who} · evaluation queued`, `Operation ${short(op.operationId)} · ${op.spec.taskIds.length} tasks × ${op.spec.models.length} models · ${op.mode}`, 'info'); continue; }
    if (!was.receipt && op.receipt) log('Payment settled on Hedera', `Receipt ${op.receipt.transactionId}`, 'ok', { toastToo: true, ms: 9000 });
    if (was.status !== op.status) {
      if (op.status === 'running') log(`${who} · evaluation running`, 'Models are operating the browser. Progress shows below as each task finishes.', 'active');
      if (op.status === 'completed') log(`${who} · report ready`, 'Delivered and validated. Reusable by other agents while it stays fresh.', 'ok', { toastToo: true, ms: 8000 });
      if (op.status === 'failed') log(`${who} · operation failed`, op.error || 'Open the activity panel to resume.', 'bad', { toastToo: true, ms: 9000 });
      if (op.status === 'settlement_unknown') log('Settlement unknown — blocked', 'Waiting for the chain to confirm. Nothing will be retried blindly.', 'warn', { toastToo: true, ms: 10000 });
    }
    if (op.status === 'running' && op.progress && JSON.stringify(was.progress) !== JSON.stringify(op.progress)) {
      log(`${op.progress.modelId} · ${TASKS[op.progress.taskId]?.label || op.progress.taskId}`, `${String(op.progress.outcome).replaceAll('_', ' ')} · ${op.progress.steps?.length ?? ''} actions`, op.progress.outcome === 'passed' ? 'ok' : 'warn');
    }
  }
  if (next.stats.successfulReuses > prev.stats.successfulReuses) log('Report reused from shared memory', 'Answered without a payment or a new run.', 'ok', { toastToo: true, ms: 8000 });
  const confirmedBefore = prev.decisions.filter(d => /sequence/.test(d.publication || '')).length;
  const confirmedNow = next.decisions.filter(d => /sequence/.test(d.publication || '')).length;
  if (confirmedNow > confirmedBefore) log('Decision note published to HCS', `${confirmedNow - confirmedBefore} note${confirmedNow - confirmedBefore === 1 ? '' : 's'} confirmed on the consensus topic.`, 'ok');
}

/* An operation error is shown for the session in which it happened, then not again.
   Errors already seen when the page loaded stay hidden; new ones show until the next reload. */
let seenAtLoad = new Set();
function loadSeenErrors() { try { seenAtLoad = new Set(JSON.parse(localStorage.getItem('common.seen-errors') || '[]')); } catch { seenAtLoad = new Set(); } }
function errorVisible(op) {
  if (!op.error) return false;
  const key = `${op.operationId}:${op.error}`;
  if (seenAtLoad.has(key)) return false;
  try {
    const all = new Set(JSON.parse(localStorage.getItem('common.seen-errors') || '[]'));
    if (!all.has(key)) { all.add(key); localStorage.setItem('common.seen-errors', JSON.stringify([...all].slice(-200))); }
  } catch { /* storage unavailable */ }
  return true;
}

/* Re-render a section only when its data actually changed — no flicker on the 2s poll. */
const rendered = new Map();
function changed(key, value) { const s = JSON.stringify(value); if (rendered.get(key) === s) return false; rendered.set(key, s); return true; }

// ------------------------------------------------------------------ router
const VIEWS = ['overview', 'lab', 'evidence', 'memory', 'ledger'];
function currentView() { const h = location.hash.replace('#', ''); return VIEWS.includes(h) ? h : 'overview'; }
function route() {
  const view = currentView();
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  $('crumb').textContent = view === 'lab' ? 'EVALUATION LAB' : view === 'memory' ? 'DECISION MEMORY' : view === 'ledger' ? 'LEDGER' : view.toUpperCase();
  window.scrollTo({ top: 0 });
}
function go(view) { if (currentView() !== view) location.hash = view; else route(); }
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ render
function renderHeader() {
  const local = !isTestnet();
  $('mode').textContent = local ? 'LOCAL INFERENCE · NO PAYMENTS' : 'HEDERA TESTNET';
  $('mode-note').textContent = state.readOnly
    ? 'Read-only review of stored evidence. New evaluations, payments and transaction retries are disabled.'
    : local ? 'Models run on this computer through Ollama. This session sends no Hedera payments or HCS messages.'
    : 'Evaluation purchases settle on Hedera testnet through x402. Uncertain payments stay blocked until reconciled.';
  $('workspace-name').textContent = state.workspaceId;
  $('ledger-mode').textContent = local ? 'LOCAL · NO PAYMENTS' : 'HEDERA TESTNET';
  $('st-mode').textContent = state.readOnly ? 'Read-only' : local ? 'Local' : 'Testnet';
  $('st-workspace').textContent = state.workspaceId;
  $('st-models').textContent = state.spec ? `${state.spec.models.length} ready` : 'Not ready';
  $('st-models').className = state.spec ? '' : 'bad';
  $('st-ops').textContent = String(state.operations.length);
  $('st-spend').textContent = `${hbar(state.stats.purchaseSpend.amount)} HBAR`;
}

function renderMetrics() {
  const stats = state.stats, total = stats.successfulAcquisitions + stats.successfulReuses;
  $('acquisitions').textContent = stats.successfulAcquisitions;
  $('reuses').textContent = stats.successfulReuses;
  $('reuse-rate').textContent = total ? `${Math.round(stats.successfulReuses / total * 100)}%` : '—';
  $('payments').textContent = state.operations.filter(o => o.receipt).length;
  $('spend').textContent = `${hbar(stats.purchaseSpend.amount)} HBAR in evaluation purchases`;
  const reports = state.operations.filter(o => o.resultId).length;
  $('nav-evidence-count').hidden = !reports; $('nav-evidence-count').textContent = reports;
  $('nav-memory-count').hidden = !state.decisions.length; $('nav-memory-count').textContent = state.decisions.length;
}

function renderSpec() {
  const spec = state.spec;
  if (!changed('spec', [spec, state.readinessError])) return;
  $('models').innerHTML = spec ? spec.models.map(m => `<div class="model"><span class="model-icon">${esc(m.id[0] || 'm')}</span><div><strong>${esc(m.id)}</strong><small>${esc(m.quantization)} · digest ${esc(m.revision.slice(7, 19))}</small></div><span class="pill">${esc(m.license || 'OPEN')}</span></div>`).join('')
    : `<p class="muted">${esc(state.readinessError || 'Models are not ready')}</p>`;
  const ids = spec?.taskIds || [];
  $('task-count').textContent = ids.length ? `· ${ids.length} tasks` : '';
  $('tasks').innerHTML = ids.map(id => `<li><strong>${esc(TASKS[id]?.label || id)}</strong><small>${esc(TASKS[id]?.detail || '')}</small></li>`).join('');
  $('spec-hash').textContent = spec ? `suite ${spec.suiteId} v${spec.suiteVersion}` : '';
  $('spec-grid').innerHTML = spec ? [
    ['Repetitions', spec.repetitions], ['Max actions / task', spec.maxSteps], ['Time limit / task', `${Math.round(spec.maxTaskDurationMs / 1000)}s`],
    ['Output tokens', spec.maxOutputTokens], ['Context', `${spec.contextTokens} tokens`], ['Temperature', spec.temperature],
    ['Prompt version', spec.promptVersion], ['Tool version', spec.toolVersion], ['Runtime', esc(String(spec.measurementContext || '')).slice(0, 18) || '—'],
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') : '';
}

function timeline(op) {
  const paid = !!op.receipt, testnet = op.mode !== 'local';
  const steps = testnet
    ? [['Requested', true], ['Reserved', true], ['Paid', paid], ['Running', paid && op.status !== 'queued'], ['Delivered', op.status === 'completed']]
    : [['Requested', true], ['Queued', true], ['Running', op.status !== 'queued'], ['Delivered', op.status === 'completed']];
  const stuck = op.status === 'failed' || op.status === 'settlement_unknown';
  return `<ol class="timeline ${stuck ? 'stuck' : ''}">${steps.map(([label, done], i) => `<li class="${done ? 'done' : ''} ${!done && steps[i - 1]?.[1] && !stuck ? 'now' : ''}"><span></span>${esc(label)}</li>`).join('')}</ol>`;
}

function runCard(op, compact = false) {
  const st = STATUS[op.status] || { label: op.status, tone: 'pending', text: '' };
  const who = AGENTS[op.agentId] || op.agentId;
  const total = op.spec.taskIds.length * op.spec.models.length * (op.spec.repetitions || 1);
  const running = op.status === 'running';
  return `<div class="run ${esc(op.status)}" data-op="${esc(op.operationId)}">
    <div class="run-head"><div><strong>${esc(who)} · Support desk</strong><small>${esc(short(op.operationId))} · ${op.spec.taskIds.length} tasks × ${op.spec.models.length} models · ${esc(op.mode)} · ${esc(timeAgo(op.createdAt))}</small></div><span class="badge ${esc(st.tone)}">${esc(st.label)}</span></div>
    ${compact ? '' : timeline(op)}
    ${compact ? '' : `<p class="run-note">${esc(st.text)}</p>`}
    ${running ? `<div class="progress-line"><span class="spin"></span><small>${op.progress ? `Latest: ${esc(op.progress.modelId)} · ${esc(TASKS[op.progress.taskId]?.label || op.progress.taskId)} · <em class="${esc(op.progress.outcome)}">${esc(String(op.progress.outcome).replaceAll('_', ' '))}</em>` : `Starting ${total} executions…`} · elapsed ${esc(elapsed(op.createdAt))}</small></div>` : ''}
    ${errorVisible(op) ? `<p class="run-error">${esc(op.error)}</p>` : ''}
    ${op.receipt ? `<small class="receipt">Receipt <a href="${hashscanTx(op.receipt.transactionId)}" target="_blank" rel="noopener">${esc(op.receipt.transactionId)} ↗</a></small>` : ''}
    <div class="run-actions">
      ${op.resultId ? `<button data-report="${esc(op.operationId)}">Inspect report ↗</button>` : ''}
      ${['failed', 'settlement_unknown'].includes(op.status) && !state.readOnly ? `<button data-retry="${esc(op.operationId)}">${op.status === 'settlement_unknown' ? 'Reconcile with chain' : 'Resume this operation'}</button>` : ''}
    </div>
  </div>`;
}

function renderRuns() {
  const ops = state.operations;
  // Elapsed counters tick, so running operations re-render; everything else only on change.
  if (!changed('runs', ops) && !ops.some(o => o.status === 'running')) return;
  $('run-count').textContent = `${ops.length} run${ops.length === 1 ? '' : 's'}`;
  $('runs').innerHTML = ops.length ? ops.map(o => runCard(o)).join('') : '<div class="empty">Your first evaluation starts here.<small>Use the bar below to request one.</small></div>';
  $('overview-activity').innerHTML = ops.length ? ops.slice(0, 3).map(o => runCard(o, true)).join('') : '<div class="empty small">Nothing has run yet.<small>Use the bar below to request an evaluation.</small></div>';
}

function renderReportList() {
  const done = state.operations.filter(o => o.resultId);
  if (!changed('reports', [done, selectedId])) return;
  $('report-list-count').textContent = done.length ? `${done.length}` : '';
  $('report-list').innerHTML = done.length ? done.map(o => `<button class="report-item ${o.operationId === selectedId ? 'active' : ''}" data-report="${esc(o.operationId)}"><strong>${esc(AGENTS[o.agentId] || o.agentId)} · ${esc(short(o.operationId))}</strong><small>${esc(timeAgo(o.updatedAt))} · ${esc(o.mode)}${o.receipt ? ' · paid' : ''}</small></button>`).join('')
    : '<p class="muted">No completed evaluations yet.</p>';
}

function renderDecisions() {
  const rows = state.decisions.filter(d => decisionFilter === 'all' || d.type === decisionFilter);
  if (!changed('decisions', [rows, decisionFilter, state.mode])) return;
  document.querySelectorAll('#decision-filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === decisionFilter));
  $('decisions').innerHTML = rows.length ? rows.map(d => {
    const published = isTestnet() ? esc(d.publication || 'HCS publication pending') : 'Local decision record · no HCS write';
    const pending = isTestnet() && !/sequence/.test(d.publication || '');
    return `<div class="decision"><div><span class="badge ${esc(DECISION_TONE[d.type] || '')}">${esc(d.type.toUpperCase())}</span></div><div><p><strong>${esc(AGENTS[d.agentId] || d.agentId)}</strong> chose <strong>${esc(d.chosen)}</strong></p><small>Rejected: ${esc(d.rejected)}</small><p class="why">${esc(d.reason)}</p><small class="${pending ? 'pending-note' : ''}">${published}${d.operationId ? ` · operation ${esc(short(d.operationId))}` : ''}</small></div><time>${esc(clock(d.createdAt))}</time></div>`;
  }).join('') : `<p class="muted">${state.decisions.length ? 'No decisions match this filter.' : 'Decision history will appear after the first request.'}</p>`;
}

function renderLedger() {
  const ops = state.operations;
  if (!changed('ledger', ops)) return;
  $('ledger-count').textContent = ops.length ? `${ops.filter(o => o.receipt).length} paid · ${ops.length} total` : '';
  if (!ops.length) { $('ledger-body').innerHTML = '<p class="muted">No operations recorded in this workspace.</p>'; return; }
  $('ledger-body').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Operation</th><th>Agent</th><th>Status</th><th>Amount</th><th>Receipt</th><th>Created</th></tr></thead><tbody>${ops.map(o => {
    const st = STATUS[o.status] || { label: o.status, tone: 'pending' };
    return `<tr><td class="mono">${esc(short(o.operationId))}</td><td>${esc(AGENTS[o.agentId] || o.agentId)}</td><td><span class="badge ${esc(st.tone)}">${esc(st.label)}</span></td><td>${o.receipt ? `${hbar(o.receipt.amount?.amount)} HBAR` : o.mode === 'local' ? '—' : 'unpaid'}</td><td>${o.receipt ? `<a href="${hashscanTx(o.receipt.transactionId)}" target="_blank" rel="noopener" class="mono">${esc(o.receipt.transactionId)} ↗</a>` : '<span class="muted">none</span>'}</td><td>${esc(clock(o.createdAt))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderButtons() {
  const ro = state.readOnly;
  $('acquire').disabled = ro || busy || !state.spec;
  $('fresh').disabled = ro || busy || !state.spec;
  $('reuse').disabled = ro || busy || !selectedSpec;
  $('agent-hint').textContent = AGENT_HINT[$('agent').value] || '';
  const active = state.operations.find(o => o.status === 'running' || o.status === 'queued');
  const done = state.operations.filter(o => o.resultId).length;
  const el = $('dock-state');
  if (ro) { el.textContent = 'Read-only'; el.className = 'dock-state'; }
  else if (busy) { el.textContent = 'Requesting…'; el.className = 'dock-state active'; }
  else if (active) { el.textContent = active.status === 'running' ? 'Evaluation running' : 'Queued'; el.className = 'dock-state active'; }
  else if (done) { el.textContent = `${done} report${done === 1 ? '' : 's'} in memory · ready to reuse`; el.className = 'dock-state ok'; }
  else { el.textContent = 'Memory empty · first request will acquire'; el.className = 'dock-state'; }
}

async function refresh() {
  try {
    const next = await api('/api/state');
    if (offline) { offline = false; log('Connected', 'Dashboard is live again.', 'ok', { toastToo: true }); }
    const firstLoad = !state;
    previous = state; state = next; lastRefresh = Date.now();
    if (!selectedSpec && state.spec) selectedSpec = state.spec;
    if (firstLoad) {
      loadFeed();
      // Reloaded mid-run with no history: say what is happening rather than showing nothing.
      const inFlight = state.operations.find(o => o.status === 'running' || o.status === 'queued');
      if (inFlight && !feed.some(e => e.tone === 'active')) {
        log(`${AGENTS[inFlight.agentId] || inFlight.agentId} · evaluation ${inFlight.status}`, `Operation ${short(inFlight.operationId)} was already in progress when this page loaded. Progress continues below.`, 'active');
      }
    }
    announce(previous, state);
    renderHeader(); renderMetrics(); renderSpec(); renderRuns(); renderReportList(); renderDecisions(); renderLedger(); renderButtons();
    $('st-refresh').textContent = 'just now'; $('live-label').textContent = state.readOnly ? 'Read-only review' : isTestnet() ? 'Live · Hedera testnet' : 'Live · local inference'; $('live-dot').className = 'status-dot';
    const latest = selectedId ? state.operations.find(o => o.operationId === selectedId) : state.operations.find(o => o.resultId);
    if (latest?.resultId && reportCacheKey !== `${latest.operationId}:${latest.updatedAt}`) {
      await showReport(latest.operationId); reportCacheKey = `${latest.operationId}:${latest.updatedAt}`;
      // A report the user asked for just landed: take them to it.
      if (userRequested) { userRequested = false; go('evidence'); }
    }
  } catch (error) {
    if (!offline) { offline = true; log('Connection lost', error.message, 'bad', { toastToo: true, ms: 8000 }); }
    $('live-label').textContent = 'Reconnecting…'; $('live-dot').className = 'status-dot off';
    message(error.message, true);
  }
}

async function showReport(id) {
  try {
    const { report, summary } = await api(`/api/reports/${encodeURIComponent(id)}`);
    selectedId = id; selectedSpec = report.spec;
    const op = state.operations.find(o => o.operationId === id);
    $('report-source').hidden = false; $('report-source').textContent = report.source === 'live' ? 'MEASURED MODEL OUTPUT' : 'FIXTURE — NOT INFERENCE';
    $('report-context').textContent = `${report.spec.taskIds.length} tasks per model · ${report.spec.repetitions} repetition · ${new Date(report.completedAt).toLocaleString()}`;
    $('download').hidden = false; $('download').href = `/api/reports/${encodeURIComponent(id)}?download=1`; $('download').download = `common-${id}.json`;
    $('report-meta').hidden = false;
    $('report-meta').innerHTML = [
      ['Operation', short(id)], ['Requested by', AGENTS[op?.agentId] || op?.agentId || '—'], ['Mode', op?.mode || '—'],
      ['Measured', elapsed(report.startedAt, report.completedAt)], ['Fresh until', new Date(report.freshUntil).toLocaleString()],
      ['Receipt', op?.receipt ? op.receipt.transactionId : 'none'],
    ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="${k === 'Receipt' || k === 'Operation' ? 'mono' : ''}">${esc(v)}</dd></div>`).join('');
    const best = summary.reduce((a, b) => (b.passRate || 0) > (a?.passRate || -1) ? b : a, null);
    $('comparison').innerHTML = `<div class="comparison">${summary.map(m => `<div class="score-card ${m === best && summary.length > 1 ? 'best' : ''}"><h3>${esc(m.modelId)} <small>· ${esc(m.quantization)}</small>${m === best && summary.length > 1 ? '<span class="pill">HIGHEST PASS RATE</span>' : ''}</h3><div class="score">${m.passed}<small> / ${m.attempted} tasks passed</small></div><progress max="1" value="${m.passRate || 0}" aria-label="${esc(m.modelId)} task pass rate"></progress><div class="score-details"><span>${(m.durationMs / 1000).toFixed(1)}s measured</span><span>${m.inputTokens + m.outputTokens} tokens</span><span class="${m.infrastructureErrors ? 'bad' : ''}">${m.infrastructureErrors} infra errors</span></div></div>`).join('')}</div>`;
    $('task-results').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Task / model</th><th>Outcome</th><th>Actions</th><th>Evidence</th></tr></thead><tbody>${report.tasks.map(t => `<tr><td><strong>${esc(TASKS[t.taskId]?.label || t.taskId)}</strong><small class="muted"> · ${esc(t.modelId)}</small></td><td><span class="outcome ${esc(t.outcome)}">${esc(t.outcome.replaceAll('_', ' '))}</span></td><td>${t.steps.length}</td><td><div class="artifacts">${t.screenshotId ? `<a href="/api/artifacts/${encodeURIComponent(id)}/${encodeURIComponent(t.screenshotId)}" target="_blank" rel="noopener">Screenshot ↗</a>` : ''}${t.traceId ? `<a href="/api/artifacts/${encodeURIComponent(id)}/${encodeURIComponent(t.traceId)}" download>Trace ↓</a>` : ''}</div><details><summary>Inspect ${t.steps.length} action${t.steps.length === 1 ? '' : 's'}</summary><ol class="actions">${t.steps.map(s => `<li><code>${esc(JSON.stringify(s.action || {}))}</code>${s.error ? `<span class="bad"> — ${esc(s.error)}</span>` : ''}<small>${s.durationMs}ms · ${s.inputTokens + s.outputTokens} tok</small></li>`).join('')}</ol>${t.failureReason ? `<p class="fail-reason">${esc(t.failureReason)}</p>` : ''}</details></td></tr>`).join('')}</tbody></table></div>`;
    $('limitations').textContent = report.limitations.join(' ');
    renderReportList();
  } catch (error) { message(error.message, true); log('Could not load report', error.message, 'bad', { toastToo: true }); }
}

async function acquire(agentId, fresh = false) {
  if (busy || !selectedSpec) return;
  busy = true; renderButtons(); userRequested = true; openBar(false);
  try {
    const spec = structuredClone(fresh ? state.spec : selectedSpec);
    if (fresh) spec.generation = crypto.randomUUID();
    message('Checking shared memory…');
    log(`${AGENTS[agentId] || agentId} · checking shared memory`, fresh ? 'Fresh measurement requested — a new evaluation will run regardless.' : 'Looking for a matching, fresh, delivered report first.', 'active');
    const result = await api('/api/evaluations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), agentId, spec }) });
    selectedId = result.operation.operationId; selectedSpec = spec; reportCacheKey = null;
    if (result.request.kind === 'reuse') { message('Using the existing evaluation. Waiting for a usable report if it is still running.'); log('Match found in shared memory', 'Reusing the existing evaluation. No new payment, no new run.', 'ok', { toastToo: true, ms: 7000 }); userRequested = false; }
    else { message('Evaluation queued. Follow its progress in the lab.'); log('No usable report in memory', isTestnet() ? 'Reserving budget on the contract, then paying through x402 before compute starts.' : 'Queuing a new local evaluation. No payment in local mode.', 'info'); go('lab'); }
  } catch (error) { message(error.message, true); log('Request refused', error.message, 'bad', { toastToo: true, ms: 8000 }); userRequested = false; }
  finally { busy = false; await refresh(); }
}

// ------------------------------------------------------------------ events
$('acquire').addEventListener('click', () => acquire($('agent').value));
$('reuse').addEventListener('click', () => acquire('agent-b'));
$('fresh').addEventListener('click', () => acquire($('agent').value, true));
$('agent').addEventListener('change', renderButtons);
$('cb-toggle').addEventListener('click', () => {
  if ($('cb-detail').hidden) { barManuallyClosed = false; openBar(true); }
  else { barManuallyClosed = true; closeBar(); }
});
$('cb-clear').addEventListener('click', () => { feed = []; renderFeed(); saveFeed(); });
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.report) { await showReport(button.dataset.report); go('evidence'); }
  if (button.dataset.retry) {
    try { await api(`/api/evaluations/${button.dataset.retry}/resume`, { method: 'POST' }); log('Resuming operation', 'Recovery checks the original transaction first. No replacement payment is made.', 'active'); await refresh(); }
    catch (error) { message(error.message, true); log('Resume refused', error.message, 'bad', { toastToo: true }); }
  }
  if (button.dataset.filter) { decisionFilter = button.dataset.filter; renderDecisions(); }
});
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  const map = { 1: 'overview', 2: 'lab', 3: 'evidence', 4: 'memory', 5: 'ledger' };
  if (map[e.key]) go(map[e.key]);
});

route();
initBar();
loadSeenErrors();
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
setInterval(() => { if (lastRefresh) $('st-refresh').textContent = timeAgo(new Date(lastRefresh).toISOString()); }, 5000);
