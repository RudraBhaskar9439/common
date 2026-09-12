import type { BrowserTaskId } from '@common/interfaces';

export const TASKS: Record<BrowserTaskId, string> = {
  'assign-ticket': 'Assign ticket 42, Duplicate invoice, to the Billing team. Preserve every other field.',
  'change-priority': 'Change ticket 43, Login loop, to urgent priority. Preserve every other field.',
  'resolve-ticket': 'Resolve ticket 44, Missing export, by changing its status to resolved. Preserve every other field.',
  'add-note': 'Add the exact note Customer confirmed duplicate charge to ticket 42. Preserve every other field.',
  'filter-tickets': 'Filter the ticket list to high priority tickets only. Do not modify any ticket.',
};

export const INITIAL_TICKETS = [
  { id: 42, title: 'Duplicate invoice', team: 'Support', priority: 'normal', status: 'open', notes: '' },
  { id: 43, title: 'Login loop', team: 'Engineering', priority: 'high', status: 'open', notes: '' },
  { id: 44, title: 'Missing export', team: 'Support', priority: 'normal', status: 'open', notes: '' },
];
export interface DeskState { tickets: typeof INITIAL_TICKETS; filter: string; visibleIds: number[] }

export function expectedState(task: BrowserTaskId): DeskState {
  const tickets = structuredClone(INITIAL_TICKETS);
  if (task === 'assign-ticket') tickets[0]!.team = 'Billing';
  if (task === 'change-priority') tickets[1]!.priority = 'urgent';
  if (task === 'resolve-ticket') tickets[2]!.status = 'resolved';
  if (task === 'add-note') tickets[0]!.notes = 'Customer confirmed duplicate charge';
  const filter = task === 'filter-tickets' ? 'high' : 'all';
  return { tickets, filter, visibleIds: tickets.filter(t => filter === 'all' || t.priority === filter).map(t => t.id) };
}

/** A fresh isolated browser context loads this application for every task. */
export function supportDeskHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Common Support Desk</title>
  <style>body{font:16px system-ui;background:#f5f4ee;color:#1a2926;max-width:950px;margin:50px auto}button,input,select{font:inherit;padding:10px;margin:6px}article{padding:16px;background:white;margin:10px 0;border:1px solid #ddd}label{display:block}#editor{padding:20px;background:#e9efea}</style></head><body>
  <h1>Support desk</h1><p>Controlled evaluation application. Synthetic tickets.</p>
  <label>Priority filter <select data-testid="priority-filter" id="filter"><option value="all">All</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
  <div id="tickets"></div><div id="editor"></div>
  <script>
  const tickets=${JSON.stringify(INITIAL_TICKETS)};let filter='all';
  function render(){document.querySelector('#tickets').innerHTML=tickets.filter(t=>filter==='all'||t.priority===filter).map(t=>'<article>Ticket '+t.id+': '+t.title+' — Team '+t.team+', priority '+t.priority+', status '+t.status+'<button data-testid="open-'+t.id+'" onclick="openTicket('+t.id+')">Open ticket '+t.id+'</button></article>').join('')}
  function openTicket(id){const t=tickets.find(t=>t.id===id);document.querySelector('#editor').innerHTML='<h2>Ticket '+id+': '+t.title+'</h2><label>Team<select data-testid="team" id="team">'+['Support','Billing','Engineering'].map(v=>'<option>'+v+'</option>').join('')+'</select></label><label>Priority<select data-testid="priority" id="priority">'+['normal','high','urgent'].map(v=>'<option>'+v+'</option>').join('')+'</select></label><label>Status<select data-testid="status" id="status">'+['open','resolved'].map(v=>'<option>'+v+'</option>').join('')+'</select></label><label>Note<input data-testid="note" id="note"></label><button data-testid="save" id="save">Save changes</button>';
  for(const field of ['team','priority','status'])document.getElementById(field).value=t[field];document.getElementById('note').value=t.notes;
  document.getElementById('save').onclick=()=>{for(const field of ['team','priority','status'])t[field]=document.getElementById(field).value;t.notes=document.getElementById('note').value;render();document.querySelector('#editor').innerHTML='<p>Saved ticket '+id+'</p>'}}
  document.getElementById('filter').onchange=e=>{filter=e.target.value;render()};
  window.deskState=()=>({tickets,filter,visibleIds:tickets.filter(t=>filter==='all'||t.priority===filter).map(t=>t.id)});render();
  </script></body></html>`;
}
