(() => {
  'use strict';

  const STORAGE_KEY = 'kumpula-payment-tracker-v1';
  const app = document.getElementById('app');

  const DEFAULT_CLIENTS = [
    { id: 'kumpula-mobile-detailing', name: 'Kumpula Mobile Detailing', amount: 200, dueDay: 12 },
    { id: 'one-clear-choice', name: 'The One Clear Choice Auto Glass', amount: null, dueDay: 14 },
    { id: 'zh-homes', name: 'ZH Homes', amount: null, dueDay: 26 }
  ];

  let data = loadData();
  let modalClientId = null;
  let toastTimer = null;

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Array.isArray(saved.clients) && Array.isArray(saved.payments)) {
        const byId = new Map(saved.clients.map(c => [c.id, c]));
        const clients = DEFAULT_CLIENTS.map(def => ({ ...def, ...(byId.get(def.id) || {}) }));
        return { clients, payments: saved.payments };
      }
    } catch (_) {}
    return { clients: DEFAULT_CLIENTS.map(c => ({ ...c })), payments: [] };
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function money(value) {
    if (value == null || Number.isNaN(Number(value))) return 'Not set';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function monthLabel(period) {
    const [year, month] = period.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1));
  }

  function periodKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function paidFor(clientId, period) {
    return data.payments.some(p => p.clientId === clientId && p.period === period);
  }

  function nextDue(client) {
    const now = new Date();
    const currentPeriod = periodKey(now);
    const currentDue = new Date(now.getFullYear(), now.getMonth(), client.dueDay);

    if (!paidFor(client.id, currentPeriod)) {
      return { date: currentDue, period: currentPeriod };
    }

    const next = new Date(now.getFullYear(), now.getMonth() + 1, client.dueDay);
    return { date: next, period: periodKey(next) };
  }

  function calendarDayDiff(target, from = new Date()) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.round((b - a) / 86400000);
  }

  function dueText(date) {
    const days = calendarDayDiff(date);
    if (days < 0) return { text: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, cls: 'overdue' };
    if (days === 0) return { text: 'Due today', cls: 'soon' };
    if (days === 1) return { text: 'Tomorrow', cls: 'soon' };
    if (days <= 5) return { text: `In ${days} days`, cls: 'soon' };
    return { text: `In ${days} days`, cls: '' };
  }

  function totals() {
    const now = new Date();
    const thisMonthKey = periodKey(now);
    const monthlyRevenue = data.clients.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const collectedThisMonth = data.payments
      .filter(p => periodKey(new Date(p.paidAt)) === thisMonthKey)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalRevenue = data.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
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

  function render() {
    const summary = totals();
    const ordered = [...data.clients]
      .map(client => ({ client, due: nextDue(client) }))
      .sort((a, b) => a.due.date - b.due.date);

    const history = [...data.payments].sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)).slice(0, 8);
    const now = new Date();

    app.innerHTML = `
      <div class="shell">
        <header class="header">
          <div>
            <div class="eyebrow">Kumpula</div>
            <h1>Payments</h1>
            <p class="subtitle">A simple view of what’s due and what you’ve collected.</p>
          </div>
          <div class="today">${formatDate(now)}</div>
        </header>

        <section class="stats" aria-label="Payment summary">
          <article class="stat">
            <div class="stat-label">Monthly revenue</div>
            <div class="stat-value">${money(summary.monthlyRevenue)}</div>
            <div class="stat-note">Based on set monthly payments</div>
          </article>
          <article class="stat">
            <div class="stat-label">Collected this month</div>
            <div class="stat-value">${money(summary.collectedThisMonth)}</div>
            <div class="stat-note">Payments marked received this month</div>
          </article>
          <article class="stat">
            <div class="stat-label">Total revenue collected</div>
            <div class="stat-value">${money(summary.totalRevenue)}</div>
            <div class="stat-note">All payments recorded here</div>
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
              const amountSet = client.amount != null && Number(client.amount) > 0;
              return `
                <article class="payment-card">
                  <div class="client-block">
                    <div class="client-name">${escapeHtml(client.name)}</div>
                    <div class="client-meta">Due every month on the ${ordinal(client.dueDay)}</div>
                  </div>
                  <div class="amount-block">
                    <div class="${amountSet ? 'amount' : 'amount-unset'}">${money(client.amount)}</div>
                    <button class="amount-edit" data-edit="${client.id}">${amountSet ? 'Edit amount' : 'Set amount'}</button>
                  </div>
                  <div class="due-block">
                    <div class="due-date">${formatDate(due.date)}</div>
                    <div class="due-count ${status.cls}">${status.text}</div>
                  </div>
                  <button class="primary-btn" data-paid="${client.id}">Mark paid</button>
                </article>
              `;
            }).join('')}
          </div>
        </section>

        <section class="recent">
          <div class="section-head">
            <h2 class="section-title">Recent payments</h2>
            <div class="section-note">Newest first</div>
          </div>
          <div class="history">
            ${history.length ? history.map(p => {
              const client = data.clients.find(c => c.id === p.clientId);
              return `
                <div class="history-row">
                  <div>
                    <div class="history-name">${escapeHtml(client?.name || 'Client')}</div>
                    <div class="history-period">${monthLabel(p.period)} payment</div>
                  </div>
                  <div class="history-amount">${money(p.amount)}</div>
                  <div class="history-date">Received ${formatDate(new Date(p.paidAt))}</div>
                  <button class="danger-btn" data-undo="${p.id}">Undo</button>
                </div>
              `;
            }).join('') : '<div class="empty">No payments recorded yet.</div>'}
          </div>
        </section>
      </div>
      ${modalClientId ? renderAmountModal(modalClientId) : ''}
    `;

    bindEvents();
  }

  function renderAmountModal(clientId) {
    const client = data.clients.find(c => c.id === clientId);
    if (!client) return '';
    return `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="amount-title" data-modal-panel>
          <h2 id="amount-title">Monthly payment</h2>
          <p>Set the recurring monthly payment for ${escapeHtml(client.name)}.</p>
          <form id="amount-form">
            <div class="input-wrap">
              <span class="input-prefix">$</span>
              <input class="money-input" id="amount-input" type="number" min="0" step="1" inputmode="decimal" value="${client.amount ?? ''}" placeholder="0" autofocus required />
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

  function bindEvents() {
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        modalClientId = btn.dataset.edit;
        render();
        queueMicrotask(() => document.getElementById('amount-input')?.focus());
      });
    });

    document.querySelectorAll('[data-paid]').forEach(btn => {
      btn.addEventListener('click', () => markPaid(btn.dataset.paid));
    });

    document.querySelectorAll('[data-undo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const payment = data.payments.find(p => p.id === btn.dataset.undo);
        data.payments = data.payments.filter(p => p.id !== btn.dataset.undo);
        saveData();
        render();
        showToast(payment ? 'Payment removed.' : 'Updated.');
      });
    });

    const backdrop = document.querySelector('[data-close-modal]');
    if (backdrop) {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) closeModal();
      });
    }
    document.getElementById('cancel-modal')?.addEventListener('click', closeModal);
    document.getElementById('amount-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const client = data.clients.find(c => c.id === modalClientId);
      const value = Number(document.getElementById('amount-input').value);
      if (!client || !Number.isFinite(value) || value < 0) return;
      client.amount = value;
      saveData();
      modalClientId = null;
      render();
      showToast('Monthly payment updated.');
    });
  }

  function closeModal() {
    modalClientId = null;
    render();
  }

  function markPaid(clientId) {
    const client = data.clients.find(c => c.id === clientId);
    if (!client) return;
    if (client.amount == null || Number(client.amount) <= 0) {
      modalClientId = clientId;
      render();
      queueMicrotask(() => document.getElementById('amount-input')?.focus());
      showToast('Set the payment amount first.');
      return;
    }

    const due = nextDue(client);
    if (paidFor(client.id, due.period)) return;

    data.payments.push({
      id: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      clientId: client.id,
      period: due.period,
      amount: Number(client.amount),
      paidAt: new Date().toISOString()
    });
    saveData();
    render();
    showToast(`${client.name} marked paid.`);
  }

  function ordinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    if (n % 10 === 1) return `${n}st`;
    if (n % 10 === 2) return `${n}nd`;
    if (n % 10 === 3) return `${n}rd`;
    return `${n}th`;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 2200);
  }

  render();
})();
