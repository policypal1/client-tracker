(() => {
  'use strict';

  const CONFIG = window.COMPLA_CONFIG || {};
  const SUPABASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const SUPABASE_ANON_KEY = String(CONFIG.SUPABASE_ANON_KEY || '');
  const CLOUD = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  const STORAGE_KEY = 'compla-client-os-v2';
  const SESSION_KEY = 'compla-client-os-session-v1';

  const TASK_PRESETS = [
    'Google Ads optimization',
    'Search terms & negative keywords',
    'Conversion tracking',
    'Landing page / website update',
    'Lead form / automation',
    'Lead quality / call review',
    'Client follow-up / strategy check-in',
    'Reporting / performance summary',
    'Google Business Profile',
    'Meta / Facebook Ads'
  ];

  const state = {
    data: { clients: [], tasks: [], payments: [], activities: [] },
    view: 'dashboard',
    mobileNav: false,
    loading: true,
    error: '',
    session: loadSession(),
    clientQuery: '',
    clientStatus: 'all',
    taskClientFilter: 'all',
    taskPriorityFilter: 'all'
  };

  const app = document.getElementById('app');

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function nowIso() { return new Date().toISOString(); }

  function periodKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function defaultClients() {
    const now = nowIso();
    return [
      {
        id: uid(), name: 'Kaiser Mobile Detailing', status: 'active', priority: 'medium',
        monthly_amount: 200, payment_due_day: 12,
        current_focus: 'Keep marketing work moving and watch monthly performance.',
        next_step: 'Review current results and decide the next highest-impact update.',
        notes: '', last_touched_at: now, created_at: now
      },
      {
        id: uid(), name: 'The One Clear Choice Auto Glass', status: 'active', priority: 'medium',
        monthly_amount: null, payment_due_day: 14,
        current_focus: 'Monitor lead flow, calls, and booked-job quality.',
        next_step: 'Review recent campaign performance and lead quality.',
        notes: '', last_touched_at: now, created_at: now
      },
      {
        id: uid(), name: 'ZH Homes', status: 'active', priority: 'high',
        monthly_amount: null, payment_due_day: 26,
        current_focus: 'Generate qualified deck quote requests and improve Google Ads efficiency.',
        next_step: 'Review search terms, negatives, CPC, conversion tracking, and landing-page behavior.',
        notes: '', last_touched_at: now, created_at: now
      }
    ];
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          clients: Array.isArray(parsed.clients) ? parsed.clients : [],
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          payments: Array.isArray(parsed.payments) ? parsed.payments : [],
          activities: Array.isArray(parsed.activities) ? parsed.activities : []
        };
      }
    } catch (_) {}
    const initial = { clients: defaultClients(), tasks: [], payments: [], activities: [] };
    saveLocal(initial);
    return initial;
  }

  function saveLocal(data = state.data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
  }

  function saveSession(session) {
    state.session = session;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  async function refreshSession() {
    if (!state.session?.refresh_token) return false;
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: state.session.refresh_token })
    });
    if (!response.ok) {
      saveSession(null);
      return false;
    }
    const data = await response.json();
    saveSession(normalizeSession(data));
    return true;
  }

  function normalizeSession(data) {
    if (!data?.access_token) return null;
    const expiresIn = Number(data.expires_in || 3600);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + Math.max(30, expiresIn - 60) * 1000,
      user: data.user || null
    };
  }

  async function ensureToken() {
    if (!CLOUD) return null;
    if (!state.session?.access_token) return null;
    if (state.session.expires_at && Date.now() >= state.session.expires_at) {
      const ok = await refreshSession();
      if (!ok) return null;
    }
    return state.session.access_token;
  }

  async function authRequest(path, body) {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || `Auth request failed (${response.status})`);
    return data;
  }

  async function signIn(email, password) {
    const data = await authRequest('/auth/v1/token?grant_type=password', { email, password });
    saveSession(normalizeSession(data));
  }

  async function signUp(email, password) {
    const data = await authRequest('/auth/v1/signup', { email, password });
    const session = normalizeSession(data);
    if (session) saveSession(session);
    return Boolean(session);
  }

  function signOut() {
    saveSession(null);
    state.data = { clients: [], tasks: [], payments: [], activities: [] };
    render();
  }

  async function rest(table, { method = 'GET', query = '', body, prefer = '' } = {}, retry = true) {
    const token = await ensureToken();
    if (!token) throw new Error('Your Supabase session expired. Please sign in again.');
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    if (prefer) headers['Prefer'] = prefer;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 401 && retry && state.session?.refresh_token) {
      const ok = await refreshSession();
      if (ok) return rest(table, { method, query, body, prefer }, false);
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Supabase request failed (${response.status})`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function fetchData() {
    if (!CLOUD) return loadLocal();
    const [clients, tasks, payments, activities] = await Promise.all([
      rest('clients', { query: 'select=*&order=created_at.asc' }),
      rest('tasks', { query: 'select=*&order=created_at.desc' }),
      rest('payment_records', { query: 'select=*&order=created_at.desc' }),
      rest('activities', { query: 'select=*&order=created_at.desc&limit=100' })
    ]);
    let clientRows = clients || [];
    if (!clientRows.length) {
      const seeds = defaultClients().map(({ id, ...restClient }) => restClient);
      clientRows = await rest('clients', { method: 'POST', body: seeds, prefer: 'return=representation' });
    }
    return { clients: clientRows || [], tasks: tasks || [], payments: payments || [], activities: activities || [] };
  }

  async function reloadData() {
    state.loading = true;
    render();
    try {
      state.data = await fetchData();
      state.error = '';
    } catch (err) {
      state.error = err.message || String(err);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function insertRow(table, row) {
    if (!CLOUD) return null;
    const rows = await rest(table, { method: 'POST', body: row, prefer: 'return=representation' });
    return rows?.[0] || null;
  }

  async function patchRow(table, id, patch) {
    if (!CLOUD) return null;
    const rows = await rest(table, { method: 'PATCH', query: `id=eq.${encodeURIComponent(id)}`, body: patch, prefer: 'return=representation' });
    return rows?.[0] || null;
  }

  async function deleteRow(table, id) {
    if (!CLOUD) return;
    await rest(table, { method: 'DELETE', query: `id=eq.${encodeURIComponent(id)}` });
  }

  function dueDateFor(client, period = periodKey()) {
    if (!client.payment_due_day) return null;
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(client.payment_due_day, lastDay);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  function paymentFor(clientId, period = periodKey()) {
    return state.data.payments.find(p => p.client_id === clientId && p.period === period);
  }

  function paymentState(client, now = new Date()) {
    const due = dueDateFor(client, periodKey(now));
    if (!due) return { state: 'none', due: null, days: null };
    const record = paymentFor(client.id, periodKey(now));
    if (record?.paid_at) return { state: 'paid', due, days: 0 };
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const delta = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    if (delta < 0) return { state: 'overdue', due, days: Math.abs(delta) };
    if (delta <= 7) return { state: 'due_soon', due, days: delta };
    return { state: 'upcoming', due, days: delta };
  }

  function paymentLabel(info) {
    if (info.state === 'paid') return 'Paid';
    if (info.state === 'overdue') return `${info.days}d overdue`;
    if (info.state === 'due_soon') return info.days === 0 ? 'Due today' : `Due in ${info.days}d`;
    if (info.state === 'upcoming') return `${info.days}d away`;
    return 'Not set';
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === '') return 'Set amount';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
  }

  function formatDate(value, includeYear = false) {
    if (!value) return 'No date';
    const date = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}) }).format(date);
  }

  function daysSince(iso) {
    if (!iso) return 999;
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  }

  function clientPulse(client) {
    let score = 100;
    const pay = paymentState(client);
    if (pay.state === 'overdue') score -= 35;
    if (pay.state === 'due_soon') score -= 10;
    const open = state.data.tasks.filter(t => t.client_id === client.id && t.status !== 'done');
    score -= Math.min(30, open.filter(t => t.priority === 'high').length * 12);
    const stale = daysSince(client.last_touched_at);
    if (stale >= 14) score -= 25;
    else if (stale >= 7) score -= 12;
    return score >= 80 ? { score, label: 'On track' } : score >= 55 ? { score, label: 'Watch' } : { score, label: 'Needs attention' };
  }

  function priorityRank(p) { return p === 'high' ? 0 : p === 'medium' ? 1 : 2; }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join('') || 'C'; }
  function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
  function cap(value) { return String(value).charAt(0).toUpperCase() + String(value).slice(1).replaceAll('_', ' '); }
  function ordinal(n) { const s = ['th','st','nd','rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; }
  function isPastDue(date, status) { return status !== 'done' && new Date(`${date}T23:59:59`).getTime() < Date.now(); }
  function rel(iso) { const d = daysSince(iso); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : formatDate(iso); }

  async function createClient(input) {
    const row = { ...input, last_touched_at: nowIso() };
    if (CLOUD) {
      const created = await insertRow('clients', row);
      state.data.clients.push(created);
    } else {
      state.data.clients.push({ id: uid(), created_at: nowIso(), ...row });
      saveLocal();
    }
  }

  async function updateClient(id, patch) {
    if (CLOUD) {
      const updated = await patchRow('clients', id, patch);
      state.data.clients = state.data.clients.map(c => c.id === id ? updated : c);
    } else {
      state.data.clients = state.data.clients.map(c => c.id === id ? { ...c, ...patch } : c);
      saveLocal();
    }
  }

  async function removeClient(id) {
    if (CLOUD) await deleteRow('clients', id);
    state.data.clients = state.data.clients.filter(c => c.id !== id);
    state.data.tasks = state.data.tasks.filter(t => t.client_id !== id);
    state.data.payments = state.data.payments.filter(p => p.client_id !== id);
    state.data.activities = state.data.activities.filter(a => a.client_id !== id);
    if (!CLOUD) saveLocal();
  }

  async function createTask(input) {
    const row = { ...input, completed_at: input.status === 'done' ? nowIso() : null };
    if (CLOUD) {
      const created = await insertRow('tasks', row);
      state.data.tasks.unshift(created);
    } else {
      state.data.tasks.unshift({ id: uid(), created_at: nowIso(), ...row });
      saveLocal();
    }
  }

  async function updateTask(id, patch) {
    if ('status' in patch) patch.completed_at = patch.status === 'done' ? nowIso() : null;
    if (CLOUD) {
      const updated = await patchRow('tasks', id, patch);
      state.data.tasks = state.data.tasks.map(t => t.id === id ? updated : t);
    } else {
      state.data.tasks = state.data.tasks.map(t => t.id === id ? { ...t, ...patch } : t);
      saveLocal();
    }
  }

  async function removeTask(id) {
    if (CLOUD) await deleteRow('tasks', id);
    state.data.tasks = state.data.tasks.filter(t => t.id !== id);
    if (!CLOUD) saveLocal();
  }

  async function addActivity(clientId, body) {
    const row = { client_id: clientId, body };
    if (CLOUD) {
      const created = await insertRow('activities', row);
      state.data.activities.unshift(created);
    } else {
      state.data.activities.unshift({ id: uid(), created_at: nowIso(), ...row });
      state.data.activities = state.data.activities.slice(0, 100);
      saveLocal();
    }
  }

  async function togglePayment(client, paid) {
    const period = periodKey();
    const existing = paymentFor(client.id, period);
    if (!paid) {
      if (!existing) return;
      if (CLOUD) await deleteRow('payment_records', existing.id);
      state.data.payments = state.data.payments.filter(p => p.id !== existing.id);
      if (!CLOUD) saveLocal();
      return;
    }
    if (existing) {
      const patch = { paid_at: nowIso(), amount: existing.amount ?? client.monthly_amount };
      if (CLOUD) {
        const updated = await patchRow('payment_records', existing.id, patch);
        state.data.payments = state.data.payments.map(p => p.id === existing.id ? updated : p);
      } else {
        Object.assign(existing, patch);
        saveLocal();
      }
      return;
    }
    const row = { client_id: client.id, period, amount: client.monthly_amount, paid_at: nowIso(), note: '' };
    if (CLOUD) {
      const created = await insertRow('payment_records', row);
      state.data.payments.unshift(created);
    } else {
      state.data.payments.unshift({ id: uid(), created_at: nowIso(), ...row });
      saveLocal();
    }
  }

  function navButton(id, label, symbol, count = '') {
    return `<button class="nav-item ${state.view === id ? 'active' : ''}" data-action="view" data-view="${id}"><span class="nav-symbol">${symbol}</span><span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</button>`;
  }

  function render() {
    if (CLOUD && !state.session) {
      app.innerHTML = authHtml();
      bindAuth();
      return;
    }
    if (state.loading) {
      app.innerHTML = loaderHtml();
      return;
    }

    const activeClients = state.data.clients.filter(c => c.status === 'active').length;
    const openTasks = state.data.tasks.filter(t => t.status !== 'done').length;
    const highTasks = state.data.tasks.filter(t => t.status !== 'done' && t.priority === 'high').length;

    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar ${state.mobileNav ? 'sidebar-open' : ''}">
          <div class="brand-row"><div class="brand-mark">C</div><div><div class="brand-name">Compla</div><div class="brand-sub">CLIENT OS</div></div><button class="icon-btn sidebar-close" data-action="close-nav">×</button></div>
          <nav class="side-nav">
            ${navButton('dashboard','Dashboard','⌂')}
            ${navButton('clients','Clients','◫')}
            ${navButton('tasks','Task board','✓', openTasks)}
            ${navButton('payments','Payments','$')}
            ${navButton('settings','Settings','⚙')}
          </nav>
          <div class="sidebar-card"><div class="sidebar-card-label">THIS MONTH</div><div class="sidebar-mini-stat"><span>Active clients</span><strong>${activeClients}</strong></div><div class="sidebar-mini-stat"><span>High priority</span><strong>${highTasks}</strong></div><div class="sidebar-mini-stat"><span>Data mode</span><strong>${CLOUD ? 'Cloud' : 'Local'}</strong></div></div>
          <div class="sidebar-footer"><div class="sync-dot ${CLOUD ? 'cloud' : 'local'}"></div><div><strong>${CLOUD ? 'Supabase connected' : 'Local mode'}</strong><span>${CLOUD ? 'Saved to your private workspace' : 'Add config keys for cloud sync'}</span></div></div>
        </aside>
        ${state.mobileNav ? '<button class="backdrop nav-backdrop" data-action="close-nav"></button>' : ''}
        <main class="main-panel">
          <header class="topbar"><div class="topbar-left"><button class="icon-btn mobile-menu" data-action="open-nav">☰</button><div><div class="eyebrow">CLIENT OPERATIONS</div><h1>${viewLabel(state.view)}</h1></div></div><div class="topbar-actions"><button class="btn secondary desktop-only" data-action="new-task">＋ Add task</button><button class="btn primary" data-action="new-client">＋ <span class="desktop-only">Add client</span><span class="mobile-only">Client</span></button></div></header>
          ${state.error ? `<div class="error-banner"><span>!</span><span>${esc(state.error)}</span><button data-action="clear-error">×</button></div>` : ''}
          <div class="page-wrap">${renderView()}</div>
        </main>
        <div class="mobile-bottom-nav">
          <button class="${state.view === 'dashboard' ? 'active' : ''}" data-action="view" data-view="dashboard"><span>⌂</span><small>Dashboard</small></button>
          <button class="${state.view === 'clients' ? 'active' : ''}" data-action="view" data-view="clients"><span>◫</span><small>Clients</small></button>
          <button class="${state.view === 'tasks' ? 'active' : ''}" data-action="view" data-view="tasks"><span>✓</span><small>Tasks</small></button>
          <button class="${state.view === 'payments' ? 'active' : ''}" data-action="view" data-view="payments"><span>$</span><small>Payments</small></button>
        </div>
      </div>`;

    bindBaseEvents();
  }

  function viewLabel(v) {
    return ({ dashboard: 'Dashboard', clients: 'Clients', tasks: 'Task board', payments: 'Payments', settings: 'Settings' })[v] || 'Dashboard';
  }

  function renderView() {
    if (state.view === 'clients') return clientsHtml();
    if (state.view === 'tasks') return tasksHtml();
    if (state.view === 'payments') return paymentsHtml();
    if (state.view === 'settings') return settingsHtml();
    return dashboardHtml();
  }

  function metricCard(label, value, helper, symbol, action = '', accent = false) {
    return `<button class="metric-card ${action ? 'clickable' : ''} ${accent ? 'accent' : ''}" ${action ? `data-action="${action}"` : 'disabled'}><div class="metric-icon">${symbol}</div><div><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(helper)}</p></div></button>`;
  }

  function panelHeader(title, subtitle = '', action = '') {
    return `<div class="panel-header"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${action}</div>`;
  }

  function dashboardHtml() {
    const active = state.data.clients.filter(c => c.status === 'active');
    const open = state.data.tasks.filter(t => t.status !== 'done');
    const high = open.filter(t => t.priority === 'high');
    const expected = active.reduce((s,c) => s + (Number(c.monthly_amount) || 0), 0);
    const collected = state.data.payments.filter(p => p.period === periodKey() && p.paid_at).reduce((s,p) => s + (Number(p.amount) || 0), 0);
    const payAlerts = active.filter(c => ['overdue','due_soon'].includes(paymentState(c).state));
    const stale = active.filter(c => daysSince(c.last_touched_at) >= 7);
    const attention = new Set([...payAlerts.map(c => `c${c.id}`), ...stale.map(c => `c${c.id}`), ...high.map(t => `t${t.id}`)]).size;
    const pulseClients = [...active].sort((a,b) => clientPulse(a).score - clientPulse(b).score);

    const pulseRows = pulseClients.length ? pulseClients.map(client => {
      const pulse = clientPulse(client);
      const pay = paymentState(client);
      const tasks = open.filter(t => t.client_id === client.id).length;
      return `<div class="pulse-row"><div class="pulse-main"><div class="avatar">${esc(initials(client.name))}</div><div class="pulse-copy"><div class="pulse-title-row"><strong>${esc(client.name)}</strong><span class="status-pill status-${pulse.label.toLowerCase().replaceAll(' ','-')}">${pulse.label}</span></div><p class="line-clamp"><span>Now:</span> ${esc(client.current_focus || 'No current focus set')}</p><p class="line-clamp next-line"><span>Next:</span> ${esc(client.next_step || 'No next step set')}</p></div></div><div class="pulse-side"><div class="mini-label">OPEN TASKS</div><strong>${tasks}</strong></div><div class="pulse-side payment-mini"><div class="mini-label">PAYMENT</div><strong class="text-${pay.state}">${paymentLabel(pay)}</strong></div><div class="row-actions"><button class="icon-btn" data-action="new-task" data-client-id="${client.id}" title="Add task">＋</button><button class="icon-btn" data-action="edit-client" data-client-id="${client.id}" title="Edit client">···</button></div></div>`;
    }).join('') : emptyState('No clients yet','Add your first client to start tracking work.');

    const paymentRows = [...active].sort((a,b) => (a.payment_due_day || 99) - (b.payment_due_day || 99)).map(client => {
      const info = paymentState(client);
      const paid = info.state === 'paid';
      return `<div class="payment-watch-row"><div class="payment-icon payment-${info.state}">${paid ? '✓' : '◷'}</div><div class="payment-watch-copy"><strong>${esc(client.name)}</strong><span>${client.payment_due_day ? `Due ${ordinal(client.payment_due_day)}` : 'No due date'} · ${esc(formatMoney(client.monthly_amount))}</span></div><button class="pay-toggle ${paid ? 'paid' : ''}" data-action="toggle-payment" data-client-id="${client.id}" data-paid="${paid ? '0' : '1'}">${paid ? 'Paid' : 'Mark paid'}</button></div>`;
    }).join('');

    const compactTasks = [...open].sort((a,b) => priorityRank(a.priority) - priorityRank(b.priority)).slice(0,6).map(task => {
      const client = state.data.clients.find(c => c.id === task.client_id);
      return `<div class="compact-task"><span class="priority-dot ${task.priority}"></span><div><strong>${esc(task.title)}</strong><p>${esc(client?.name || 'Unknown client')} · ${esc(task.category)}</p></div>${task.due_date ? `<time>${formatDate(task.due_date)}</time>` : ''}</div>`;
    }).join('') || emptyState('Queue is clear','Add a task when you know the next client action.');

    const activities = state.data.activities.slice(0,7).map(a => {
      const client = state.data.clients.find(c => c.id === a.client_id);
      return `<div class="activity-row"><div class="activity-dot">↻</div><div><strong>${esc(client?.name || 'Deleted client')}</strong><p>${esc(a.body)}</p></div><time>${rel(a.created_at)}</time></div>`;
    }).join('') || emptyState('No activity yet','Use “Mark touched” on a client to build a simple activity trail.');

    return `<div class="stack-xl">
      <section class="hero-card"><div><div class="hero-kicker">✦ OPERATIONS SNAPSHOT</div><h2>Know exactly what needs attention next.</h2><p>Payments, client status, priorities, and next actions in one place.</p></div><div class="hero-actions"><button class="btn light" data-action="new-task">＋ Add next action</button></div></section>
      <section class="metric-grid">${metricCard('Active clients',String(active.length),'Current retained clients','◫','go-clients')}${metricCard('Known monthly revenue',formatMoney(expected),`${formatMoney(collected)} collected this month`,'$','go-payments')}${metricCard('Open tasks',String(open.length),`${high.length} high priority`,'✓','go-tasks')}${metricCard('Needs attention',String(attention),'Payments, stale clients, urgent work','!','',attention > 0)}</section>
      <section class="dashboard-grid"><div class="panel span-2">${panelHeader('Client pulse','What is happening now, and what comes next','<button class="text-btn" data-action="go-clients">View all ›</button>')}<div class="client-pulse-list">${pulseRows}</div></div><div class="panel">${panelHeader('Payment watch','Current month','<button class="text-btn" data-action="go-payments">All payments ›</button>')}<div class="payment-watch-list">${paymentRows}</div></div></section>
      <section class="dashboard-grid lower-grid"><div class="panel">${panelHeader('Priority queue','Highest-impact open work')}<div class="task-compact-list">${compactTasks}</div></div><div class="panel span-2">${panelHeader('Recent activity','A lightweight record of client touchpoints')}<div class="activity-list">${activities}</div></div></section>
    </div>`;
  }

  function clientsHtml() {
    const q = state.clientQuery.toLowerCase();
    const rows = state.data.clients.filter(c => {
      const matchQ = `${c.name} ${c.current_focus} ${c.next_step}`.toLowerCase().includes(q);
      const matchStatus = state.clientStatus === 'all' || c.status === state.clientStatus;
      return matchQ && matchStatus;
    });

    const cards = rows.map(client => {
      const pulse = clientPulse(client);
      const pay = paymentState(client);
      const open = state.data.tasks.filter(t => t.client_id === client.id && t.status !== 'done').length;
      const stale = daysSince(client.last_touched_at);
      return `<article class="client-card"><div class="client-card-top"><div class="avatar large">${esc(initials(client.name))}</div><div class="client-card-menu"><span class="priority-badge priority-${client.priority}">${esc(client.priority)}</span><button class="icon-btn" data-action="edit-client" data-client-id="${client.id}">···</button></div></div><div class="client-card-heading"><h3>${esc(client.name)}</h3><div class="client-status-line"><span class="client-status-dot ${client.status}"></span>${cap(client.status)}<span class="dot-separator">•</span><span class="pulse-text pulse-${pulse.label.toLowerCase().replaceAll(' ','-')}">${pulse.label}</span></div></div><div class="focus-block"><div class="focus-label">◎ CURRENTLY</div><p>${esc(client.current_focus || 'No current focus set yet.')}</p></div><div class="focus-block next-focus"><div class="focus-label">→ NEXT STEP</div><p>${esc(client.next_step || 'No next step set yet.')}</p></div><div class="client-card-stats"><div><span>Open tasks</span><strong>${open}</strong></div><div><span>Payment</span><strong class="text-${pay.state}">${paymentLabel(pay)}</strong></div><div><span>Last touched</span><strong>${stale === 0 ? 'Today' : `${stale}d ago`}</strong></div></div><div class="client-card-actions"><button class="btn secondary flex-1" data-action="new-task" data-client-id="${client.id}">＋ Add task</button><button class="btn ghost flex-1" data-action="touch-client" data-client-id="${client.id}">✓ Mark touched</button></div></article>`;
    }).join('');

    return `<div class="stack-lg"><div class="toolbar-row"><div class="search-box"><span>⌕</span><input id="client-search" value="${esc(state.clientQuery)}" placeholder="Search clients, focus, or next step"></div><div class="segmented">${['all','active','paused','prospect'].map(x => `<button data-action="client-status" data-status="${x}" class="${state.clientStatus === x ? 'active' : ''}">${cap(x)}</button>`).join('')}</div><button class="btn primary" data-action="new-client">＋ Add client</button></div><div class="client-card-grid">${cards}</div>${!rows.length ? `<div class="panel">${emptyState('No matching clients','Try another filter or add a new client.')}</div>` : ''}</div>`;
  }

  function tasksHtml() {
    const filtered = state.data.tasks.filter(t => (state.taskClientFilter === 'all' || t.client_id === state.taskClientFilter) && (state.taskPriorityFilter === 'all' || t.priority === state.taskPriorityFilter));
    const columns = [
      ['next','Next up','Queued and ready'],
      ['in_progress','In progress','Actively being worked'],
      ['waiting','Waiting','Blocked or waiting on client'],
      ['done','Done','Completed work']
    ];

    const board = columns.map(([status,label,helper]) => {
      const items = filtered.filter(t => t.status === status).sort((a,b) => priorityRank(a.priority) - priorityRank(b.priority));
      const cards = items.map(task => {
        const client = state.data.clients.find(c => c.id === task.client_id);
        return `<article class="task-card"><div class="task-card-meta"><span class="priority-dot ${task.priority}"></span><span>${esc(task.category)}</span><div class="task-menu"><button class="icon-btn tiny" data-action="edit-task" data-task-id="${task.id}">···</button></div></div><h4>${esc(task.title)}</h4><div class="task-client-line"><div class="avatar xs">${esc(initials(client?.name || '?'))}</div>${esc(client?.name || 'Unknown client')}</div>${task.due_date ? `<div class="task-due ${isPastDue(task.due_date,task.status) ? 'past-due' : ''}">◷ ${formatDate(task.due_date)}</div>` : ''}<div class="task-card-footer"><select data-action="move-task" data-task-id="${task.id}"><option value="next" ${task.status === 'next' ? 'selected' : ''}>Next up</option><option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In progress</option><option value="waiting" ${task.status === 'waiting' ? 'selected' : ''}>Waiting</option><option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option></select><button class="icon-btn tiny danger-hover" data-action="delete-task" data-task-id="${task.id}">×</button></div></article>`;
      }).join('') || '<div class="kanban-empty">No tasks here</div>';
      return `<section class="kanban-column"><div class="kanban-header"><div><h3>${label}</h3><p>${helper}</p></div><span>${items.length}</span></div><div class="kanban-list">${cards}</div></section>`;
    }).join('');

    return `<div class="stack-lg"><div class="toolbar-row task-toolbar"><div class="filter-select-wrap"><span>Client</span><select id="task-client-filter"><option value="all">All clients</option>${state.data.clients.map(c => `<option value="${c.id}" ${state.taskClientFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="filter-select-wrap"><span>Priority</span><select id="task-priority-filter"><option value="all">All priorities</option>${['high','medium','low'].map(p => `<option value="${p}" ${state.taskPriorityFilter === p ? 'selected' : ''}>${cap(p)}</option>`).join('')}</select></div><div class="toolbar-spacer"></div><button class="btn primary" data-action="new-task">＋ Add task</button></div><div class="kanban-board">${board}</div></div>`;
  }

  function paymentsHtml() {
    const active = state.data.clients.filter(c => c.status === 'active' && c.payment_due_day);
    const expected = active.reduce((s,c) => s + (Number(c.monthly_amount) || 0), 0);
    const collected = state.data.payments.filter(p => p.period === periodKey() && p.paid_at).reduce((s,p) => s + (Number(p.amount) || 0), 0);
    const paidCount = active.filter(c => paymentState(c).state === 'paid').length;
    const overdueCount = active.filter(c => paymentState(c).state === 'overdue').length;
    const progress = expected > 0 ? Math.min(100, Math.round(collected / expected * 100)) : 0;
    const sorted = [...active].sort((a,b) => (a.payment_due_day || 99) - (b.payment_due_day || 99));

    const tableRows = sorted.map(client => {
      const info = paymentState(client);
      const record = paymentFor(client.id);
      const paid = info.state === 'paid';
      return `<tr><td><div class="table-client"><div class="avatar small">${esc(initials(client.name))}</div><div><strong>${esc(client.name)}</strong><span>${cap(client.priority)} priority</span></div></div></td><td><button class="money-edit" data-action="edit-client" data-client-id="${client.id}">${esc(formatMoney(client.monthly_amount))}</button></td><td>${info.due ? formatDate(info.due,true) : 'Not set'}</td><td><span class="payment-status status-${info.state}">${paymentLabel(info)}</span></td><td>${record?.paid_at ? formatDate(record.paid_at) : '—'}</td><td class="table-actions"><button class="btn compact ${paid ? 'secondary' : 'primary'}" data-action="toggle-payment" data-client-id="${client.id}" data-paid="${paid ? '0' : '1'}">${paid ? 'Undo paid' : 'Mark paid'}</button></td></tr>`;
    }).join('');

    const mobileRows = sorted.map(client => {
      const info = paymentState(client);
      const paid = info.state === 'paid';
      return `<div class="payment-mobile-card"><div class="payment-mobile-head"><div class="avatar small">${esc(initials(client.name))}</div><div><strong>${esc(client.name)}</strong><span>Due ${client.payment_due_day ? ordinal(client.payment_due_day) : 'not set'}</span></div><span class="payment-status status-${info.state}">${paymentLabel(info)}</span></div><div class="payment-mobile-body"><button class="money-edit" data-action="edit-client" data-client-id="${client.id}">${esc(formatMoney(client.monthly_amount))}</button><button class="btn compact ${paid ? 'secondary' : 'primary'}" data-action="toggle-payment" data-client-id="${client.id}" data-paid="${paid ? '0' : '1'}">${paid ? 'Undo paid' : 'Mark paid'}</button></div></div>`;
    }).join('');

    return `<div class="stack-lg"><section class="payment-summary panel"><div class="payment-summary-main"><div class="eyebrow">${new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'}).format(new Date()).toUpperCase()}</div><h2>${formatMoney(collected)} collected</h2><p>${formatMoney(expected)} in known recurring revenue. Unknown client amounts are excluded until you set them.</p><div class="progress-track"><div style="width:${progress}%"></div></div></div><div class="payment-summary-stats"><div><span>Paid</span><strong>${paidCount}/${active.length}</strong></div><div><span>Overdue</span><strong>${overdueCount}</strong></div><div><span>Collection</span><strong>${progress}%</strong></div></div></section><section class="panel payments-panel">${panelHeader('Monthly retainers','Recurring due dates reset automatically each month')}<div class="payment-table-wrap"><table class="payment-table"><thead><tr><th>Client</th><th>Monthly amount</th><th>Due date</th><th>Status</th><th>Paid date</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="payment-mobile-list">${mobileRows}</div></section></div>`;
  }

  function settingsHtml() {
    return `<div class="settings-grid"><section class="panel settings-card"><div class="settings-icon">$</div><h3>Data & backup</h3><p>${CLOUD ? 'Your app is using Supabase with authenticated row-level security.' : 'You are currently in local mode. Your browser stores the data until you add your Supabase settings in config.js.'}</p><div class="settings-actions"><button class="btn secondary" data-action="export-json">↓ Export JSON</button><button class="btn ghost" data-action="refresh-data">Refresh data</button></div></section><section class="panel settings-card"><div class="settings-icon">✦</div><h3>Built-in workflow</h3><p>The task picker includes the recurring marketing-client work you use most often.</p><div class="preset-mini-grid">${TASK_PRESETS.slice(0,6).map(x => `<span>${esc(x)}</span>`).join('')}</div></section><section class="panel settings-card"><div class="settings-icon">!</div><h3>Extra features included</h3><ul class="feature-list"><li><strong>Client pulse:</strong> flags stale clients, urgent tasks, and payment issues.</li><li><strong>Revenue collection:</strong> tracks expected vs collected recurring revenue.</li><li><strong>Activity trail:</strong> records client touchpoints so nothing quietly goes stale.</li></ul></section><section class="panel settings-card"><div class="settings-icon">⚙</div><h3>Deployment</h3><p>This app has no build step. Push the folder to GitHub and import it into Vercel. For Supabase, paste your project URL and anon key into config.js.</p>${CLOUD ? '<button class="btn secondary settings-signout" data-action="sign-out">Sign out</button>' : ''}</section></div>`;
  }

  function emptyState(title, text) {
    return `<div class="empty-state"><div class="empty-icon">✓</div><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
  }

  function loaderHtml() {
    return `<div class="full-loader"><div class="loader-mark">C</div><div class="loader-bar"><span></span></div><p>Loading client workspace…</p></div>`;
  }

  function authHtml() {
    return `<div class="auth-page"><div class="auth-glow one"></div><div class="auth-glow two"></div><section class="auth-card"><div class="brand-row auth-brand"><div class="brand-mark">C</div><div><div class="brand-name">Compla</div><div class="brand-sub">CLIENT OS</div></div></div><div class="auth-copy"><div class="eyebrow">PRIVATE WORKSPACE</div><h1 id="auth-title">Welcome back.</h1><p>Your client work, recurring payments, tasks, and activity are protected by Supabase Auth and Row Level Security.</p></div><form id="auth-form" class="auth-form"><input type="hidden" id="auth-mode" value="signin"><label class="field"><span class="field-label">Email</span><input id="auth-email" type="email" required placeholder="you@example.com"></label><label class="field"><span class="field-label">Password</span><input id="auth-password" type="password" minlength="6" required placeholder="At least 6 characters"></label><div id="auth-message" class="auth-message hidden"></div><button class="btn primary auth-submit" id="auth-submit">Sign in</button></form><button class="auth-switch" id="auth-switch">First time here? Create an account</button></section></div>`;
  }

  function bindAuth() {
    const form = document.getElementById('auth-form');
    const modeEl = document.getElementById('auth-mode');
    const title = document.getElementById('auth-title');
    const submit = document.getElementById('auth-submit');
    const sw = document.getElementById('auth-switch');
    const msg = document.getElementById('auth-message');

    sw.addEventListener('click', () => {
      const signup = modeEl.value === 'signin';
      modeEl.value = signup ? 'signup' : 'signin';
      title.textContent = signup ? 'Create your workspace.' : 'Welcome back.';
      submit.textContent = signup ? 'Create account' : 'Sign in';
      sw.textContent = signup ? 'Already have an account? Sign in' : 'First time here? Create an account';
      msg.classList.add('hidden');
      msg.textContent = '';
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Working…';
      msg.classList.add('hidden');
      try {
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        if (modeEl.value === 'signin') {
          await signIn(email,password);
          await reloadData();
        } else {
          const immediate = await signUp(email,password);
          if (immediate) await reloadData();
          else {
            msg.textContent = 'Account created. If email confirmation is enabled in Supabase, confirm the email, then sign in.';
            msg.classList.remove('hidden');
          }
        }
      } catch (err) {
        msg.textContent = err.message || String(err);
        msg.classList.remove('hidden');
      } finally {
        submit.disabled = false;
        submit.textContent = modeEl.value === 'signin' ? 'Sign in' : 'Create account';
      }
    });
  }

  function bindBaseEvents() {
    document.querySelectorAll('[data-action]').forEach(el => {
      const action = el.dataset.action;
      if (el.tagName === 'SELECT' && action === 'move-task') {
        el.addEventListener('change', () => safeAction(async () => { await updateTask(el.dataset.taskId, { status: el.value }); render(); }));
        return;
      }
      el.addEventListener('click', e => handleAction(e, el));
    });

    const search = document.getElementById('client-search');
    if (search) search.addEventListener('input', e => { state.clientQuery = e.target.value; render(); requestAnimationFrame(() => { const s = document.getElementById('client-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length,s.value.length); } }); });
    const clientFilter = document.getElementById('task-client-filter');
    if (clientFilter) clientFilter.addEventListener('change', e => { state.taskClientFilter = e.target.value; render(); });
    const priorityFilter = document.getElementById('task-priority-filter');
    if (priorityFilter) priorityFilter.addEventListener('change', e => { state.taskPriorityFilter = e.target.value; render(); });
  }

  async function handleAction(event, el) {
    event.preventDefault();
    const action = el.dataset.action;
    if (action === 'view') { state.view = el.dataset.view; state.mobileNav = false; render(); window.scrollTo({top:0,behavior:'smooth'}); return; }
    if (action === 'go-clients') { state.view = 'clients'; render(); return; }
    if (action === 'go-tasks') { state.view = 'tasks'; render(); return; }
    if (action === 'go-payments') { state.view = 'payments'; render(); return; }
    if (action === 'open-nav') { state.mobileNav = true; render(); return; }
    if (action === 'close-nav') { state.mobileNav = false; render(); return; }
    if (action === 'clear-error') { state.error = ''; render(); return; }
    if (action === 'new-client') { openClientModal(); return; }
    if (action === 'edit-client') { openClientModal(state.data.clients.find(c => c.id === el.dataset.clientId)); return; }
    if (action === 'new-task') { openTaskModal(null, el.dataset.clientId || ''); return; }
    if (action === 'edit-task') { openTaskModal(state.data.tasks.find(t => t.id === el.dataset.taskId)); return; }
    if (action === 'client-status') { state.clientStatus = el.dataset.status; render(); return; }
    if (action === 'touch-client') return safeAction(async () => { const client = state.data.clients.find(c => c.id === el.dataset.clientId); if (!client) return; await updateClient(client.id,{last_touched_at:nowIso()}); await addActivity(client.id,'Client touched / checked in'); render(); });
    if (action === 'toggle-payment') return safeAction(async () => { const client = state.data.clients.find(c => c.id === el.dataset.clientId); if (!client) return; await togglePayment(client,el.dataset.paid === '1'); render(); });
    if (action === 'delete-task') return safeAction(async () => { if (!confirm('Delete this task?')) return; await removeTask(el.dataset.taskId); render(); });
    if (action === 'refresh-data') return reloadData();
    if (action === 'export-json') return exportJson();
    if (action === 'sign-out') return signOut();
  }

  async function safeAction(fn) {
    try { state.error = ''; await fn(); }
    catch (err) { state.error = err.message || String(err); render(); }
  }

  function modalWrap(content) {
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.innerHTML = `<button class="backdrop" data-modal-close></button><div class="modal-card">${content}</div>`;
    document.body.appendChild(layer);
    layer.querySelector('[data-modal-close]').addEventListener('click', () => layer.remove());
    return layer;
  }

  function field(label, control, helper = '', extra = '') {
    return `<label class="field ${extra}"><span class="field-label">${esc(label)}</span>${control}${helper ? `<span class="field-helper">${esc(helper)}</span>` : ''}</label>`;
  }

  function openClientModal(client) {
    const isEdit = Boolean(client);
    const c = client || { name:'',status:'active',priority:'medium',monthly_amount:'',payment_due_day:'',current_focus:'',next_step:'',notes:'' };
    const layer = modalWrap(`<form id="client-form" class="modal-form"><div class="modal-header"><div><div class="eyebrow">${isEdit ? 'CLIENT DETAILS' : 'NEW CLIENT'}</div><h2>${isEdit ? esc(c.name) : 'Add a client'}</h2>${isEdit ? `<p>${state.data.tasks.filter(t => t.client_id === c.id && t.status !== 'done').length} open tasks · Last touched ${daysSince(c.last_touched_at) === 0 ? 'today' : `${daysSince(c.last_touched_at)} days ago`}</p>` : ''}</div><button type="button" class="icon-btn" id="client-modal-close">×</button></div><div class="form-grid two">${field('Client name',`<input id="cf-name" value="${esc(c.name)}" required placeholder="Business name">`,'','span-2-field')}${field('Status',`<select id="cf-status"><option value="active" ${c.status==='active'?'selected':''}>Active</option><option value="paused" ${c.status==='paused'?'selected':''}>Paused</option><option value="prospect" ${c.status==='prospect'?'selected':''}>Prospect</option></select>`)}${field('Priority',`<select id="cf-priority"><option value="high" ${c.priority==='high'?'selected':''}>High</option><option value="medium" ${c.priority==='medium'?'selected':''}>Medium</option><option value="low" ${c.priority==='low'?'selected':''}>Low</option></select>`)}${field('Monthly payment',`<div class="input-prefix"><span>$</span><input id="cf-amount" type="number" min="0" step="1" value="${c.monthly_amount ?? ''}" placeholder="Optional"></div>`)}${field('Payment due day',`<input id="cf-due" type="number" min="1" max="31" value="${c.payment_due_day ?? ''}" placeholder="1–31">`)}</div>${field("What's currently going on?",`<textarea id="cf-focus" rows="3" placeholder="Current situation, campaign status, blocker, or main focus">${esc(c.current_focus || '')}</textarea>`,'The main focus or situation right now.')}${field('What are you doing next?',`<textarea id="cf-next" rows="3" placeholder="The single next action you want visible at a glance">${esc(c.next_step || '')}</textarea>`,'The next move, not a full to-do list.')}${field('Notes',`<textarea id="cf-notes" rows="3" placeholder="Optional notes">${esc(c.notes || '')}</textarea>`,'Anything useful that does not belong above.')}<div class="modal-footer"><div>${isEdit ? '<button type="button" class="btn danger" id="delete-client">Delete</button>' : ''}</div><div class="modal-footer-right"><button type="button" class="btn ghost" id="cancel-client">Cancel</button><button class="btn primary" id="save-client">${isEdit ? 'Save changes' : 'Add client'}</button></div></div></form>`);
    const close = () => layer.remove();
    layer.querySelector('#client-modal-close').onclick = close;
    layer.querySelector('#cancel-client').onclick = close;
    if (isEdit) layer.querySelector('#delete-client').onclick = () => safeAction(async () => { if (!confirm(`Delete ${c.name} and all related data?`)) return; await removeClient(c.id); close(); render(); });
    layer.querySelector('#client-form').addEventListener('submit', e => safeAction(async () => {
      e.preventDefault();
      const input = {
        name: layer.querySelector('#cf-name').value.trim(),
        status: layer.querySelector('#cf-status').value,
        priority: layer.querySelector('#cf-priority').value,
        monthly_amount: layer.querySelector('#cf-amount').value === '' ? null : Number(layer.querySelector('#cf-amount').value),
        payment_due_day: layer.querySelector('#cf-due').value === '' ? null : Math.min(31,Math.max(1,Number(layer.querySelector('#cf-due').value))),
        current_focus: layer.querySelector('#cf-focus').value.trim(),
        next_step: layer.querySelector('#cf-next').value.trim(),
        notes: layer.querySelector('#cf-notes').value.trim()
      };
      if (!input.name) return;
      const button = layer.querySelector('#save-client'); button.disabled = true; button.textContent = 'Saving…';
      if (isEdit) await updateClient(c.id,input); else await createClient(input);
      close(); render();
    }));
    setTimeout(() => layer.querySelector('#cf-name')?.focus(),0);
  }

  function openTaskModal(task, preselectedClientId = '') {
    const t = task || { client_id:preselectedClientId || state.data.clients[0]?.id || '', title:'',category:'',status:'next',priority:'medium',due_date:'',notes:'' };
    const layer = modalWrap(`<form id="task-form" class="modal-form"><div class="modal-header"><div><div class="eyebrow">${task ? 'EDIT TASK' : 'NEXT ACTION'}</div><h2>${task ? 'Update task' : 'Add client work'}</h2><p>Use a common task type or make a custom one.</p></div><button type="button" class="icon-btn" id="task-modal-close">×</button></div><div class="preset-section"><label>Common client work</label><div class="preset-grid">${TASK_PRESETS.map(p => `<button type="button" data-preset="${esc(p)}" class="${t.category===p?'selected':''}">${esc(p)}</button>`).join('')}</div></div><div class="form-grid two">${field('Client',`<select id="tf-client" required><option value="" disabled ${!t.client_id?'selected':''}>Select client</option>${state.data.clients.map(c => `<option value="${c.id}" ${t.client_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`)}${field('Category',`<input id="tf-category" value="${esc(t.category)}" placeholder="Custom category">`)}${field('Task title',`<input id="tf-title" value="${esc(t.title)}" required placeholder="What exactly needs to happen?">`,'','span-2-field')}${field('Status',`<select id="tf-status"><option value="next" ${t.status==='next'?'selected':''}>Next up</option><option value="in_progress" ${t.status==='in_progress'?'selected':''}>In progress</option><option value="waiting" ${t.status==='waiting'?'selected':''}>Waiting</option><option value="done" ${t.status==='done'?'selected':''}>Done</option></select>`)}${field('Priority',`<select id="tf-priority"><option value="high" ${t.priority==='high'?'selected':''}>High</option><option value="medium" ${t.priority==='medium'?'selected':''}>Medium</option><option value="low" ${t.priority==='low'?'selected':''}>Low</option></select>`)}${field('Due date',`<input id="tf-due" type="date" value="${esc(t.due_date || '')}">`,'','span-2-field')}</div>${field('Notes',`<textarea id="tf-notes" rows="3" placeholder="Optional context, numbers, links, or blockers">${esc(t.notes || '')}</textarea>`)}<div class="modal-footer"><div></div><div class="modal-footer-right"><button type="button" class="btn ghost" id="cancel-task">Cancel</button><button class="btn primary" id="save-task">${task ? 'Save task' : 'Add task'}</button></div></div></form>`);
    const close = () => layer.remove();
    layer.querySelector('#task-modal-close').onclick = close;
    layer.querySelector('#cancel-task').onclick = close;
    layer.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
      layer.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('selected'));
      btn.classList.add('selected');
      layer.querySelector('#tf-category').value = btn.dataset.preset;
      if (!layer.querySelector('#tf-title').value.trim()) layer.querySelector('#tf-title').value = btn.dataset.preset;
    }));
    layer.querySelector('#task-form').addEventListener('submit', e => safeAction(async () => {
      e.preventDefault();
      const input = {
        client_id: layer.querySelector('#tf-client').value,
        title: layer.querySelector('#tf-title').value.trim(),
        category: layer.querySelector('#tf-category').value.trim() || 'Custom task',
        status: layer.querySelector('#tf-status').value,
        priority: layer.querySelector('#tf-priority').value,
        due_date: layer.querySelector('#tf-due').value || null,
        notes: layer.querySelector('#tf-notes').value.trim()
      };
      if (!input.client_id || !input.title) return;
      const button = layer.querySelector('#save-task'); button.disabled = true; button.textContent = 'Saving…';
      if (task) await updateTask(task.id,input); else await createTask(input);
      close(); render();
    }));
    setTimeout(() => layer.querySelector('#tf-title')?.focus(),0);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `compla-client-os-${periodKey()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function boot() {
    if (!CLOUD) {
      state.data = loadLocal();
      state.loading = false;
      render();
      return;
    }
    if (!state.session) {
      state.loading = false;
      render();
      return;
    }
    if (state.session.expires_at && Date.now() >= state.session.expires_at) await refreshSession();
    if (!state.session) { state.loading = false; render(); return; }
    await reloadData();
  }

  boot();
})();
