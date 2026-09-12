const token = document.querySelector('meta[name="ember-token"]').content;
export async function api(route, data) {
  const res = await fetch(`/api/${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'x-ember-token': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await res.json(); if (!res.ok) throw new Error(value.error || 'Request failed'); return value;
}
export async function subscribe(onState, signal) {
  const res = await fetch('/api/events', { headers: { 'x-ember-token': token }, signal }); if (!res.ok) throw new Error('Could not connect to the workspace.');
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let end; while ((end = buffer.indexOf('\n\n')) >= 0) { const event = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (event.startsWith('data: ')) onState(JSON.parse(event.slice(6))); } }
}
export const bytes = n => !Number.isFinite(n) ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${(n / 1e3).toFixed(0)} KB`;
export const cloud = m => Boolean(m.remote_host || /(?:^|[-:])cloud(?:$|-)/i.test(m.name || ''));
export const busy = t => ['running', 'queued', 'approval'].includes(t?.status);
export const relativeTime = value => { const diff = Math.max(0, Date.now() - Date.parse(value)); return diff < 60000 ? 'Just now' : diff < 3600000 ? `${Math.floor(diff / 60000)}m` : diff < 86400000 ? `${Math.floor(diff / 3600000)}h` : new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
