'use strict';

// =============================================================
// CONFIGURATION — must match main.js
// =============================================================
// Local dev:  'http://localhost:8787'
// Production: replace YOUR_SUBDOMAIN with your Cloudflare subdomain (e.g. goncaloaraujo)
const API_BASE = 'https://babyshower-worker.goncalo-araujo.workers.dev';

// Admin password stored in memory only — cleared on page reload / logout
let _adminPassword = null;

// Cache of fetched items for the edit modal
let _cachedItems = [];

// =============================================================
// UTILITIES
// =============================================================

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setFeedback(el, type, msg) {
  if (!el) return;
  el.className = 'form__feedback';
  if (type) {
    el.classList.add(`show--${type}`);
    el.textContent = msg ?? '';
  } else {
    el.textContent = '';
  }
}

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Password': _adminPassword,
  };
}

// =============================================================
// AUTH
// =============================================================

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const feedback = document.getElementById('login-feedback');
  const loginBtn = document.getElementById('login-btn');
  const password = document.getElementById('password-input').value;

  setFeedback(feedback, null);
  loginBtn.disabled = true;
  loginBtn.textContent = 'A verificar…';

  try {
    const res = await fetch(`${API_BASE}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || 'Palavra-passe incorreta');
    }

    _adminPassword = password;
    document.getElementById('login-screen').hidden = true;
    document.getElementById('admin-dashboard').hidden = false;
    loadItems();

  } catch (err) {
    setFeedback(feedback, 'error', err.message || 'Falha ao entrar. Por favor tenta novamente.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  _adminPassword = null;
  _cachedItems = [];
  document.getElementById('admin-dashboard').hidden = true;
  document.getElementById('login-screen').hidden = false;
  document.getElementById('password-input').value = '';
  document.getElementById('password-input').focus();
});

// =============================================================
// TABS
// =============================================================

document.querySelectorAll('.admin-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    // Update tab styles
    document.querySelectorAll('.admin-tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');

    // Show the correct panel
    document.querySelectorAll('.admin-panel').forEach((p) => { p.hidden = true; });
    const targetPanel = document.getElementById(`tab-${tab.dataset.tab}`);
    if (targetPanel) targetPanel.hidden = false;

    // Load data for the panel
    if (tab.dataset.tab === 'contributions') loadContributions();
  });
});

// =============================================================
// GIFT ITEMS — Load and render table
// =============================================================

async function loadItems() {
  const wrap = document.getElementById('items-table-wrap');
  wrap.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">A carregar&hellip;</div>';

  try {
    const res = await fetch(`${API_BASE}/api/items`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    _cachedItems = items;
    renderItemsTable(items);
  } catch (err) {
    wrap.innerHTML = `<div style="padding:var(--space-8);color:var(--color-error)">Erro ao carregar presentes: ${escHtml(err.message)}</div>`;
    console.error('Load items error:', err);
  }
}

function renderItemsTable(items) {
  const wrap = document.getElementById('items-table-wrap');

  if (items.length === 0) {
    wrap.innerHTML = `
      <div style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">
        Ainda não há presentes. Clica em <strong>+ Adicionar Presente</strong> para começar.
      </div>`;
    return;
  }

  const rows = items.map((item) => {
    const isFunded = item.is_funded === 1 || item.is_funded === true;
    const pct = item.price_total > 0
      ? Math.round((Number(item.price_raised) / Number(item.price_total)) * 100)
      : 0;
    return `
      <tr>
        <td style="color:var(--color-text-muted);font-size:var(--text-xs)">#${item.id}</td>
        <td>
          <strong>${escHtml(item.title)}</strong>
          ${item.image_url ? `<br><a href="${escHtml(item.image_url)}" target="_blank" rel="noopener" style="font-size:var(--text-xs);color:var(--color-text-muted)">Imagem ↗</a>` : ''}
        </td>
        <td>€${Number(item.price_total).toFixed(2)}</td>
        <td>€${Number(item.price_raised).toFixed(2)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <div style="flex:1;height:4px;background:var(--color-border);border-radius:999px;min-width:60px;overflow:hidden;">
              <div style="width:${pct}%;height:100%;background:${isFunded ? 'var(--color-funded)' : 'var(--color-accent)'};border-radius:999px;"></div>
            </div>
            <span style="font-size:var(--text-xs);color:var(--color-text-muted);white-space:nowrap">${pct}%</span>
          </div>
        </td>
        <td>
          ${isFunded
            ? '<span style="color:var(--color-funded);font-size:var(--text-xs);font-weight:600;">✓ Financiado</span>'
            : '<span style="color:var(--color-text-muted);font-size:var(--text-xs);">Em curso</span>'
          }
        </td>
        <td>
          <div class="admin-table__actions">
            <button class="btn btn--outline btn--sm" onclick="openEditModal(${item.id})">Editar</button>
            <button
              class="btn btn--outline btn--sm"
              style="color:var(--color-error);border-color:var(--color-error);"
              onclick="confirmDeleteItem(${item.id}, '${escHtml(item.title).replace(/'/g, "\\'")}')">
              Eliminar
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Nome</th>
          <th>Objetivo</th>
          <th>Angariado</th>
          <th style="min-width:120px">Progresso</th>
          <th>Estado</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// =============================================================
// GIFT ITEMS — Add / Edit modal
// =============================================================

document.getElementById('add-item-btn').addEventListener('click', () => {
  openAddModal();
});

function openAddModal() {
  document.getElementById('modal-title-text').textContent = 'Adicionar Presente';
  document.getElementById('modal-save').textContent = 'Adicionar';
  document.getElementById('item-form').reset();
  document.getElementById('item-id').value = '';
  setFeedback(document.getElementById('modal-feedback'), null);
  document.getElementById('item-modal').hidden = false;
  document.getElementById('item-title').focus();
}

function openEditModal(id) {
  const item = _cachedItems.find((i) => i.id === id);
  if (!item) return;

  document.getElementById('modal-title-text').textContent = 'Editar Presente';
  document.getElementById('modal-save').textContent = 'Guardar Alterações';
  document.getElementById('item-id').value = item.id;
  document.getElementById('item-title').value = item.title ?? '';
  document.getElementById('item-description').value = item.description ?? '';
  document.getElementById('item-image').value = item.image_url ?? '';
  document.getElementById('item-link').value = item.product_url ?? '';
  document.getElementById('item-price').value = item.price_total ?? '';
  document.getElementById('item-funded').checked = item.is_funded === 1 || item.is_funded === true;
  setFeedback(document.getElementById('modal-feedback'), null);
  document.getElementById('item-modal').hidden = false;
  document.getElementById('item-title').focus();
}

// Close modal
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', closeModal);
document.getElementById('item-modal').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

function closeModal() {
  document.getElementById('item-modal').hidden = true;
}

// Submit (create or update)
document.getElementById('item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const feedback = document.getElementById('modal-feedback');
  const saveBtn = document.getElementById('modal-save');
  setFeedback(feedback, null);

  const id = document.getElementById('item-id').value;
  const body = {
    title:       document.getElementById('item-title').value.trim(),
    description: document.getElementById('item-description').value.trim(),
    image_url:   document.getElementById('item-image').value.trim(),
    product_url: document.getElementById('item-link').value.trim(),
    price_total: parseFloat(document.getElementById('item-price').value),
    is_funded:   document.getElementById('item-funded').checked ? 1 : 0,
  };

  if (!body.title) {
    setFeedback(feedback, 'error', 'O nome é obrigatório.');
    document.getElementById('item-title').focus();
    return;
  }
  if (isNaN(body.price_total) || body.price_total < 0) {
    setFeedback(feedback, 'error', 'Introduz um preço válido (0 ou superior).');
    document.getElementById('item-price').focus();
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'A guardar…';

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/api/items/${id}` : `${API_BASE}/api/items`;

    const res = await fetch(url, {
      method,
      headers: adminHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `Server error (${res.status})`);
    }

    closeModal();
    await loadItems();

  } catch (err) {
    setFeedback(feedback, 'error', err.message || 'Erro ao guardar. Por favor tenta novamente.');
    console.error('Save item error:', err);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = id ? 'Guardar Alterações' : 'Adicionar';
  }
});

// =============================================================
// GIFT ITEMS — Delete
// =============================================================

function confirmDeleteItem(id, title) {
  if (!confirm(`Eliminar "${title}"?\n\nIsto irá eliminar também todas as contribuições para este presente. Esta ação não pode ser desfeita.`)) return;
  deleteItem(id);
}

async function deleteItem(id) {
  try {
    const res = await fetch(`${API_BASE}/api/items/${id}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `Server error (${res.status})`);
    }
    await loadItems();
  } catch (err) {
    alert(`Erro ao eliminar o presente: ${err.message}`);
    console.error('Delete error:', err);
  }
}

// =============================================================
// CONTRIBUTIONS — Load and render table
// =============================================================

document.getElementById('refresh-contributions-btn').addEventListener('click', () => {
  loadContributions(); // refresh
});

async function loadContributions() {
  const wrap = document.getElementById('contributions-table-wrap');
  wrap.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">A carregar&hellip;</div>';

  try {
    const res = await fetch(`${API_BASE}/api/contributions`, {
      headers: adminHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Não autorizado — por favor recarrega a página e entra novamente.');
      throw new Error(`HTTP ${res.status}`);
    }
    const contributions = await res.json();
    renderContributionsTable(contributions);
  } catch (err) {
    wrap.innerHTML = `<div style="padding:var(--space-8);color:var(--color-error)">Erro ao carregar contribuições: ${escHtml(err.message)}</div>`;
    console.error('Load contributions error:', err);
  }
}

function renderContributionsTable(contributions) {
  const wrap = document.getElementById('contributions-table-wrap');

  if (contributions.length === 0) {
    wrap.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">Ainda não há contribuições.</div>';
    return;
  }

  const total = contributions.reduce((sum, c) => sum + Number(c.amount), 0);

  const rows = contributions.map((c) => {
    const date = new Date(c.created_at).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
    return `
      <tr data-id="${c.id}">
        <td style="color:var(--color-text-muted);font-size:var(--text-xs)">#${c.id}</td>
        <td>${escHtml(c.item_title ?? '—')}</td>
        <td><strong>${escHtml(c.contributor_name)}</strong></td>
        <td><strong>€${Number(c.amount).toFixed(2)}</strong></td>
        <td style="color:var(--color-text-muted);font-size:var(--text-sm);max-width:240px">
          ${c.message ? escHtml(c.message) : '<em style="opacity:0.5">Sem mensagem</em>'}
        </td>
        <td style="white-space:nowrap;font-size:var(--text-sm);color:var(--color-text-muted)">${date}</td>
        <td>
          <button class="btn btn--outline btn--sm delete-contribution-btn"
            data-id="${c.id}"
            style="color:var(--color-error);border-color:var(--color-error)"
            title="Apagar contribuição">
            🗑
          </button>
        </td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <div style="padding:var(--space-4) var(--space-4) var(--space-2);color:var(--color-text-muted);font-size:var(--text-sm)">
      <strong style="color:var(--color-text)">${contributions.length}</strong> contribuição${contributions.length !== 1 ? 'ões' : ''}
      &nbsp;·&nbsp;
      Total angariado: <strong style="color:var(--color-funded)">€${total.toFixed(2)}</strong>
    </div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Presente</th>
          <th>Contribuinte</th>
          <th>Valor</th>
          <th>Mensagem</th>
          <th>Data</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  wrap.querySelectorAll('.delete-contribution-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('Apagar esta contribuição? O valor será subtraído do progresso do presente.')) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const res = await fetch(`${API_BASE}/api/contributions/${id}`, {
          method: 'DELETE',
          headers: adminHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const row = wrap.querySelector(`tr[data-id="${id}"]`);
        if (row) row.remove();
        // Update total in summary
        await loadContributions();
      } catch (err) {
        alert('Erro ao apagar: ' + err.message);
        btn.disabled = false;
        btn.textContent = '🗑';
      }
    });
  });
}

// =============================================================
// EXPOSE GLOBALS — needed because table uses inline onclick
// =============================================================
window.openEditModal = openEditModal;
window.confirmDeleteItem = confirmDeleteItem;
