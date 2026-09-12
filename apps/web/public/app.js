const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, selectedSpec, selectedId, reportCacheKey, busy = false;
async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
const labels = { 'assign-ticket':'Assign the right team', 'change-priority':'Change ticket priority', 'resolve-ticket':'Resolve a ticket', 'add-note':'Add the exact note', 'filter-tickets':'Filter the ticket list' };
function hbar(amount) { const n = BigInt(amount || '0'); return `${n / 100000000n}.${(n % 100000000n).toString().padStart(8,'0').replace(/0+$/,'') || '0'}`; }
function message(text, error = false) { $('action-message').textContent = text; $('action-message').className = error ? 'error' : ''; }
async function refresh() {
  try {
    state = await api('/api/state');
    if (!selectedSpec && state.spec) selectedSpec = state.spec;
    $('mode').textContent = state.mode === 'local' ? 'LOCAL INFERENCE · NO PAYMENTS' : 'HEDERA TESTNET';
    $('mode-note').textContent = state.mode === 'local' ? 'Models run on this computer through Ollama. This session sends no Hedera payments or HCS messages.' : 'Evaluation purchases settle on Hedera testnet. Uncertain payments stay blocked until reconciled.';
    $('workspace-name').textContent = state.workspaceId;
    const stats = state.stats, total = stats.successfulAcquisitions + stats.successfulReuses;
    $('acquisitions').textContent = stats.successfulAcquisitions; $('reuses').textContent = stats.successfulReuses;
    $('reuse-rate').textContent = total ? `${Math.round(stats.successfulReuses / total * 100)}%` : '—';
    $('payments').textContent = state.operations.filter(o => o.receipt).length;
    $('spend').textContent = `${hbar(stats.purchaseSpend.amount)} HBAR in evaluation purchases`;
    $('models').innerHTML = (state.spec?.models || []).map(m => `<div class="model"><span class="model-icon">q</span><div><strong>${esc(m.id)}</strong><small>${esc(m.quantization)} · ${esc(m.revision.slice(7,19))}</small></div><span class="pill">APACHE 2.0</span></div>`).join('') || `<p class="muted">${esc(state.readinessError || 'Models are not ready')}</p>`;
    $('acquire').disabled = busy || !state.spec; $('fresh').disabled = busy || !state.spec; $('reuse').disabled = busy || !selectedSpec;
    $('run-count').textContent = `${state.operations.length} run${state.operations.length === 1 ? '' : 's'}`;
    if (state.operations.length) $('runs').innerHTML = state.operations.map(o => `<div class="run"><div class="run-head"><strong>${esc(o.agentId === 'agent-a' ? 'Agent A' : 'Agent B')} · Support desk</strong><span class="badge ${esc(o.status)}">${esc(o.status.replaceAll('_',' '))}</span></div><small>${esc(o.operationId.slice(0,8))} · ${o.spec.taskIds.length} tasks × ${o.spec.models.length} models · ${esc(o.mode)}</small>${o.error ? `<p class="run-error">${esc(o.error)}</p>` : ''}${o.progress ? `<small>Latest: ${esc(o.progress.modelId)} · ${esc(labels[o.progress.taskId])} · ${esc(o.progress.outcome)}</small>` : ''}${o.resultId ? `<button data-report="${esc(o.operationId)}">Inspect report ↗</button>` : ''}${['failed','settlement_unknown'].includes(o.status) ? `<button data-retry="${esc(o.operationId)}">Resume this operation</button>` : ''}${o.receipt ? `<small>Receipt: ${esc(o.receipt.transactionId)}</small>` : ''}</div>`).join('');
    $('decisions').innerHTML = state.decisions.length ? state.decisions.map(d => `<div class="decision"><div><span class="badge">${esc(d.type.toUpperCase())}</span></div><div><p>${esc(d.agentId)} chose <strong>${esc(d.chosen)}</strong></p><small>Rejected: ${esc(d.rejected)}</small><p class="why">${esc(d.reason)}</p><small>${state.mode === 'local' ? 'Local decision record · no HCS write' : esc(d.publication || 'HCS publication pending')}</small></div><time>${new Date(d.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div>`).join('') : '<p class="muted">Decision history will appear after the first request.</p>';
    const latest = selectedId ? state.operations.find(o => o.operationId === selectedId) : state.operations.find(o => o.resultId);
    if (latest?.resultId && reportCacheKey !== `${latest.operationId}:${latest.updatedAt}`) { await showReport(latest.operationId); reportCacheKey = `${latest.operationId}:${latest.updatedAt}`; }
  } catch (error) { message(error.message, true); }
}
async function showReport(id) {
  try {
    const { report, summary } = await api(`/api/reports/${encodeURIComponent(id)}`);
    selectedId = id; selectedSpec = report.spec;
    $('report-source').hidden = false; $('report-source').textContent = report.source === 'live' ? 'MEASURED MODEL OUTPUT' : 'FIXTURE — NOT INFERENCE';
    $('report-context').textContent = `${report.spec.taskIds.length} tasks per model · ${report.spec.repetitions} repetition · ${new Date(report.completedAt).toLocaleString()}`;
    $('download').hidden = false; $('download').href = `/api/reports/${encodeURIComponent(id)}?download=1`; $('download').download = `common-${id}.json`;
    $('comparison').innerHTML = `<div class="comparison">${summary.map(m => `<div class="score-card"><h3>${esc(m.modelId)} <small>· ${esc(m.quantization)}</small></h3><div class="score">${m.passed}<small> / ${m.attempted} tasks passed</small></div><progress max="1" value="${m.passRate || 0}" aria-label="${esc(m.modelId)} task pass rate"></progress><div class="score-details"><span>${(m.durationMs / 1000).toFixed(1)}s measured</span><span>${m.inputTokens + m.outputTokens} tokens</span><span>${m.infrastructureErrors} infra errors</span></div></div>`).join('')}</div>`;
    $('task-results').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Task / model</th><th>Outcome</th><th>Actions</th><th>Evidence</th></tr></thead><tbody>${report.tasks.map(t => `<tr><td>${esc(labels[t.taskId])}<small class="muted"> · ${esc(t.modelId)}</small></td><td class="${esc(t.outcome)}">${esc(t.outcome.replaceAll('_',' '))}</td><td>${t.steps.length}</td><td><div class="artifacts">${t.screenshotId ? `<a href="/api/artifacts/${encodeURIComponent(id)}/${encodeURIComponent(t.screenshotId)}" target="_blank" rel="noopener">Screenshot ↗</a>` : ''}${t.traceId ? `<a href="/api/artifacts/${encodeURIComponent(id)}/${encodeURIComponent(t.traceId)}" download>Trace ↓</a>` : ''}</div><details><summary>Inspect actions</summary>${t.steps.map(s => `<div>${s.step}. ${esc(JSON.stringify(s.action || {}))}${s.error ? ` — ${esc(s.error)}` : ''}</div>`).join('')}${t.failureReason ? `<p>${esc(t.failureReason)}</p>` : ''}</details></td></tr>`).join('')}</tbody></table></div>`;
    $('limitations').textContent = report.limitations.join(' ');
  } catch (error) { message(error.message, true); }
}
async function acquire(agentId, fresh = false) {
  if (busy || !selectedSpec) return;
  busy = true; $('acquire').disabled = true;
  try {
    const spec = structuredClone(fresh ? state.spec : selectedSpec);
    if (fresh) spec.generation = crypto.randomUUID();
    message('Checking shared memory…');
    const result = await api('/api/evaluations', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ requestId:crypto.randomUUID(), agentId, spec }) });
    selectedId = result.operation.operationId; selectedSpec = spec; reportCacheKey = null;
    message(result.request.kind === 'reuse' ? 'Using the existing evaluation. Waiting for a usable report if it is still running.' : 'Evaluation queued. You can follow its progress here.');
  } catch (error) { message(error.message, true); }
  finally { busy = false; await refresh(); }
}
$('acquire').onclick = () => acquire($('agent').value);
$('reuse').onclick = () => acquire('agent-b');
$('fresh').onclick = () => acquire($('agent').value, true);
$('runs').onclick = async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.report) { await showReport(button.dataset.report); $('evidence').scrollIntoView({behavior:'smooth'}); }
  if (button.dataset.retry) { try { await api(`/api/evaluations/${button.dataset.retry}/resume`, {method:'POST'}); await refresh(); } catch(error) { message(error.message,true); } }
};
void refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
