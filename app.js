(() => {
  'use strict';

  const STORAGE_KEY = 'kumpula-payment-tracker-v3';
  const OLD_STORAGE_KEYS = ['kumpula-payment-tracker-v2', 'kumpula-payment-tracker-v1'];
  const app = document.getElementById('app');

  const CONFIG = window.PAYMENT_TRACKER_CONFIG || {};
  const SUPABASE_URL = String(CONFIG.supabaseUrl || '').trim().replace(/\/$/, '');
  const SUPABASE_KEY = String(CONFIG.supabaseKey || '').trim();
  const CLOUD_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY && window.supabase?.createClient);
  const sb = CLOUD_CONFIGURED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  const DEFAULT_CLIENTS = [
    { id: 'kumpula-mobile-detailing', name: 'Keizer Mobile Detailing', amount: 200, dueDay: 12 },
    { id: 'one-clear-choice', name: 'The One Clear Choice Auto Glass', amount: 200, dueDay: 20 },
    { id: 'zh-homes', name: 'ZH Homes', amount: 400, dueDay: 26 }
  ];

  let data = loadLocalData();
  let session = null;
  let modalClientId = null;
  let openMenuClientId = null;
  let toastTimer = null;
  let saveTimer = null;
  let syncState = CLOUD_CONFIGURED ? 'connecting' : 'local';
  let syncErrorMessage = '';

  function normalizeData(saved) {
    const savedClients = Array.isArray(saved?.clients) ? saved.clients : [];
    const byId = new Map(savedClients.map(client => [client.id, client]));
    const clients = DEFAULT_CLIENTS.map(def => {
      const previous = byId.get(def.id) || {};
      return {
        ...def,
        ...previous,
        amount: previous.amount == null ? def.amount : Number(previous.amount),
        dueDay: def.dueDay,
        name: def.name
      };
    });

    return {
      clients,
      payments: Array.isArray(saved?.payments) ? saved.payments : [],
      skips: Array.isArray(saved?.skips) ? saved.skips : []
    };
  }

  function loadLocalData() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) {
        for (const key of OLD_STORAGE_KEYS) {
          const candidate = JSON.parse(localStorage.getItem(key) || 'null');
          if (candidate) {
            saved = candidate;
            break;
          }
        }
      }
    } catch (_) {}

    const normalized = normalizeData(saved || {});
    saveLocalData(normalized);
    return normalized;
  }

  function saveLocalData(value = data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function saveData() {
    saveLocalData(data);
    if (!sb || !session?.user?.id) return;

    syncState = 'saving';
    updateSyncBadge();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveCloudData(), 180);
  }

  async function saveCloudData() {
    if (!sb || !session?.user?.id) return;
    const userId = session.user.id;

    const { error } = await sb
      .from('payment_tracker')
      .upsert({
        user_id: userId,
        data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    syncState = error ? 'error' : 'synced';
    syncErrorMessage = error ? (error.message || 'Supabase save failed.') : '';
    updateSyncBadge();
    if (error) console.error('Supabase save failed:', error);
  }

  async function loadCloudData() {
    if (!sb || !session?.user?.id) return;
    syncState = 'connecting';
    renderDashboard();

    const userId = session.user.id;
    const { data: row, error } = await sb
      .from('payment_tracker')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Supabase load failed:', error);
      syncState = 'error';
      syncErrorMessage = error.message || 'Could not load Supabase.';
      renderDashboard();
      showToast('Could not load Supabase. Your payments are still saved on this device.', 4200);
      return;
    }

    if (row?.data) {
      data = normalizeData(row.data);
      saveLocalData(data);
      syncState = 'synced';
      syncErrorMessage = '';
      renderDashboard();
      return;
    }

    // First login: copy the current browser data into Supabase.
    syncState = 'saving';
    renderDashboard();
    await saveCloudData();
    renderDashboard();
  }

  async function init() {
    // Always show the tracker immediately. Supabase authentication happens
    // silently in the background using an anonymous user, so there is no
    // sign-in page or account setup.
    renderDashboard();

    if (!CLOUD_CONFIGURED) return;

    try {
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      session = sessionData?.session || null;

      if (!session) {
        syncState = 'connecting';
        updateSyncBadge();
        const { data: anonymousData, error: anonymousError } = await sb.auth.signInAnonymously();
        if (anonymousError) throw anonymousError;
        session = anonymousData?.session || null;
      }

      if (!session?.user?.id) throw new Error('Supabase did not return an anonymous session.');
      await loadCloudData();
    } catch (error) {
      console.error('Supabase background sync failed:', error);
      const message = String(error?.message || error || 'Unknown Supabase error');
      syncState = 'error';
      syncErrorMessage = message;
      updateSyncBadge();

      if (/anonymous/i.test(message) && /(disabled|not enabled|provider)/i.test(message)) {
        showToast('Enable Anonymous Sign-Ins in Supabase Authentication, then refresh this page.', 6500);
      } else {
        showToast(`Supabase sync error: ${message}`, 6500);
      }
    }
  }

  function uid() {
    try {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch (_) {}
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function money(value) {
    if (value == null || Number.isNaN(Number(value))) return 'Not set';
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0
    }).format(Number(value));
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }).format(date);
  }

  function monthLabel(period) {
    const [year, month] = period.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', year: 'numeric'
    }).format(new Date(year, month - 1, 1));
  }

  function periodKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function paidFor(clientId, period) {
    return data.payments.some(payment => payment.clientId === clientId && payment.period === period);
  }

  function skippedFor(clientId, period) {
    return data.skips.some(skip => skip.clientId === clientId && skip.period === period);
  }

  function handledFor(clientId, period) {
    return paidFor(clientId, period) || skippedFor(clientId, period);
  }

  function nextDue(client) {
    const now = new Date();
    let candidate = new Date(now.getFullYear(), now.getMonth(), client.dueDay);
    let period = periodKey(candidate);

    while (handledFor(client.id, period)) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 1, client.dueDay);
      period = periodKey(candidate);
    }

    return { date: candidate, period };
  }

  function calendarDayDiff(target, from = new Date()) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.round((b - a) / 86400000);
  }

  function dueText(date) {
    const days = calendarDayDiff(date);
    if (days < 0) {
      const overdue = Math.abs(days);
      return { text: `${overdue} day${overdue === 1 ? '' : 's'} overdue`, cls: 'overdue' };
    }
    if (days === 0) return { text: 'Due today', cls: 'soon' };
    if (days === 1) return { text: 'Tomorrow', cls: 'soon' };
    return { text: `In ${days} days`, cls: days <= 7 ? 'soon' : '' };
  }

  function totals() {
    const now = new Date();
    const thisMonth = periodKey(now);
    const monthlyRevenue = data.clients.reduce((sum, client) => sum + (Number(client.amount) || 0), 0);
    const collectedThisMonth = data.payments
      .filter(payment => payment.period === thisMonth)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const totalRevenue = data.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return { monthlyRevenue, collectedThisMonth, totalRevenue };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function syncLabel() {
    if (!CLOUD_CONFIGURED) return 'Local only';
    if (syncState === 'saving') return 'Saving…';
    if (syncState === 'error') return 'Sync error';
    if (syncState === 'connecting') return 'Connecting…';
    return 'Synced';
  }

  function renderDashboard() {
    const summary = totals();
    const now = new Date();
    const ordered = [...data.clients]
      .map(client => ({ client, due: nextDue(client) }))
      .sort((a, b) => a.due.date - b.due.date);

    const activity = [
      ...data.payments.map(payment => ({ ...payment, type: 'paid', at: payment.paidAt })),
      ...data.skips.map(skip => ({ ...skip, type: 'skipped', at: skip.skippedAt }))
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8);

    app.innerHTML = `
      <div class="shell">
        <header class="header">
          <div>
            <div class="eyebrow">Kumpula</div>
            <h1>Payments</h1>
            <p class="subtitle">See what’s coming up, then mark it paid or skip it.</p>
          </div>
          <div class="header-side">
            <div class="today">${formatDate(now)}</div>
            <div class="sync-line">
              <span class="sync-badge ${syncState}" id="sync-badge" title="${escapeHtml(syncErrorMessage || syncLabel())}">${syncLabel()}</span>
            </div>
          </div>
        </header>

        <section class="stats" aria-label="Payment summary">
          <article class="stat">
            <div class="stat-label">Monthly revenue</div>
            <div class="stat-value">${money(summary.monthlyRevenue)}</div>
            <div class="stat-note">Recurring revenue scheduled each month</div>
          </article>
          <article class="stat">
            <div class="stat-label">Collected this month</div>
            <div class="stat-value">${money(summary.collectedThisMonth)}</div>
            <div class="stat-note">Payments received for ${monthLabel(periodKey(now))}</div>
          </article>
          <article class="stat">
            <div class="stat-label">Total revenue collected</div>
            <div class="stat-value">${money(summary.totalRevenue)}</div>
            <div class="stat-note">All payments you’ve marked paid</div>
          </article>
        </section>

        <section>
          <div class="section-head">
            <h2 class="section-title">Upcoming payments</h2>
            <div class="section-note">Closest payment first</div>
          </div>
          <div class="payment-list">
            ${ordered.map(({ client, due }) => {
              const status = dueText(due.date);
              const menuOpen = openMenuClientId === client.id;
              return `
                <article class="payment-card ${menuOpen ? 'menu-open' : ''}">
                  <div class="client-block">
                    <div class="client-name">${escapeHtml(client.name)}</div>
                    <div class="client-meta">Due every month on the ${ordinal(client.dueDay)}</div>
                  </div>
                  <div class="amount-block">
                    <div class="amount">${money(client.amount)}</div>
                  </div>
                  <div class="due-block">
                    <div class="due-date">${formatDate(due.date)}</div>
                    <div class="due-count ${status.cls}">${status.text}</div>
                  </div>
                  <button class="primary-btn" data-paid="${client.id}">Mark paid</button>
                  <div class="menu-wrap">
                    <button class="menu-btn" data-menu="${client.id}" aria-label="More options for ${escapeHtml(client.name)}" aria-expanded="${menuOpen}">•••</button>
                    ${menuOpen ? `
                      <div class="menu-popover">
                        <button data-skip="${client.id}">Skip ${monthLabel(due.period)} payment</button>
                        <button data-edit="${client.id}">Edit monthly amount</button>
                      </div>
                    ` : ''}
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        </section>

        <section class="recent">
          <div class="section-head">
            <h2 class="section-title">Recent activity</h2>
            <div class="section-note">Payments and skips</div>
          </div>
          <div class="history">
            ${activity.length ? activity.map(item => {
              const client = data.clients.find(c => c.id === item.clientId);
              const isPaid = item.type === 'paid';
              return `
                <div class="history-row">
                  <div>
                    <div class="history-name">${escapeHtml(client?.name || 'Client')}</div>
                    <div class="history-period">${monthLabel(item.period)} payment</div>
                  </div>
                  <div class="history-amount ${isPaid ? '' : 'skip-label'}">${isPaid ? money(item.amount) : 'Skipped'}</div>
                  <div class="history-date">${isPaid ? 'Received' : 'Skipped'} ${formatDate(new Date(item.at))}</div>
                  <button class="danger-btn" data-undo-type="${item.type}" data-undo="${item.id}">Undo</button>
                </div>
              `;
            }).join('') : '<div class="empty">No payment activity yet.</div>'}
          </div>
        </section>
      </div>
      ${modalClientId ? renderAmountModal(modalClientId) : ''}
    `;

    bindDashboardEvents();
  }

  function renderAmountModal(clientId) {
    const client = data.clients.find(c => c.id === clientId);
    if (!client) return '';
    return `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="amount-title">
          <h2 id="amount-title">Monthly payment</h2>
          <p>Change the recurring payment amount for ${escapeHtml(client.name)}.</p>
          <form id="amount-form">
            <div class="input-wrap">
              <span class="input-prefix">$</span>
              <input class="money-input" id="amount-input" type="number" min="0" step="1" inputmode="decimal" value="${client.amount ?? ''}" placeholder="0" required />
            </div>
            <div class="modal-actions">
              <button type="button" class="ghost-btn" id="cancel-modal">Cancel</button>
              <button type="submit" class="primary-btn">Save amount</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function bindDashboardEvents() {
    document.querySelectorAll('[data-menu]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const clientId = button.dataset.menu;
        openMenuClientId = openMenuClientId === clientId ? null : clientId;
        renderDashboard();
      });
    });

    document.querySelectorAll('[data-paid]').forEach(button => {
      button.addEventListener('click', () => markPaid(button.dataset.paid));
    });

    document.querySelectorAll('[data-skip]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        skipPayment(button.dataset.skip);
      });
    });

    document.querySelectorAll('[data-edit]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        modalClientId = button.dataset.edit;
        openMenuClientId = null;
        renderDashboard();
        queueMicrotask(() => document.getElementById('amount-input')?.focus());
      });
    });

    document.querySelectorAll('[data-undo]').forEach(button => {
      button.addEventListener('click', () => undoActivity(button.dataset.undoType, button.dataset.undo));
    });

    const backdrop = document.querySelector('[data-close-modal]');
    backdrop?.addEventListener('click', event => {
      if (event.target === backdrop) closeModal();
    });

    document.getElementById('cancel-modal')?.addEventListener('click', closeModal);

    document.getElementById('amount-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const client = data.clients.find(c => c.id === modalClientId);
      const value = Number(document.getElementById('amount-input')?.value);
      if (!client || !Number.isFinite(value) || value < 0) return;
      client.amount = value;
      saveData();
      modalClientId = null;
      renderDashboard();
      showToast('Monthly payment updated.');
    });

    document.addEventListener('click', closeOpenMenu, { once: true });
  }

  function closeOpenMenu(event) {
    if (!openMenuClientId) return;
    if (event.target.closest('.menu-wrap')) return;
    openMenuClientId = null;
    renderDashboard();
  }
  function closeModal() {
    modalClientId = null;
    renderDashboard();
  }

  function markPaid(clientId) {
    const client = data.clients.find(c => c.id === clientId);
    if (!client) return;

    const due = nextDue(client);
    data.payments.push({
      id: uid(),
      clientId: client.id,
      period: due.period,
      amount: Number(client.amount) || 0,
      paidAt: new Date().toISOString()
    });

    openMenuClientId = null;
    saveData();
    renderDashboard();
    showToast(`${client.name} marked paid.`);
  }

  function skipPayment(clientId) {
    const client = data.clients.find(c => c.id === clientId);
    if (!client) return;
    const due = nextDue(client);
    const label = monthLabel(due.period);

    if (!window.confirm(`Skip ${client.name}'s ${label} payment?`)) return;

    data.skips.push({
      id: uid(),
      clientId: client.id,
      period: due.period,
      skippedAt: new Date().toISOString()
    });

    openMenuClientId = null;
    saveData();
    renderDashboard();
    showToast(`${label} payment skipped.`);
  }

  function undoActivity(type, id) {
    if (type === 'paid') data.payments = data.payments.filter(payment => payment.id !== id);
    if (type === 'skipped') data.skips = data.skips.filter(skip => skip.id !== id);
    saveData();
    renderDashboard();
    showToast(type === 'skipped' ? 'Skipped payment restored.' : 'Payment removed.');
  }

  function ordinal(n) {
    const value = n % 100;
    if (value >= 11 && value <= 13) return `${n}th`;
    if (n % 10 === 1) return `${n}st`;
    if (n % 10 === 2) return `${n}nd`;
    if (n % 10 === 3) return `${n}rd`;
    return `${n}th`;
  }

  function updateSyncBadge() {
    const badge = document.getElementById('sync-badge');
    if (!badge) return;
    badge.className = `sync-badge ${syncState}`;
    badge.textContent = syncLabel();
    badge.title = syncErrorMessage || syncLabel();
  }

  function showToast(message, duration = 2200) {
    clearTimeout(toastTimer);
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    toastTimer = setTimeout(() => toast.remove(), duration);
  }

  void init();
})();
