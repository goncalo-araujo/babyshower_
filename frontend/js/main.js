'use strict';

// =============================================================
// CONFIGURATION
// UPDATE this to your deployed Cloudflare Worker URL after deployment.
// For local development with `wrangler dev`, use: http://localhost:8787
// =============================================================
// Local dev:  'http://localhost:8787'
// Production: replace YOUR_SUBDOMAIN with your Cloudflare subdomain (e.g. goncaloaraujo)
const API_BASE = 'https://babyshower-worker.goncalo-araujo.workers.dev';

// Cache of loaded gift items (used to look up remaining amounts for the form hint)
let giftItems = [];

// =============================================================
// GUEST AUTH — password stored in sessionStorage for the tab lifetime
// =============================================================

let _guestPassword = sessionStorage.getItem('guestPassword') ?? null;

function guestHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Guest-Password': _guestPassword ?? '',
  };
}

async function initGuestGate() {
  // Already authenticated this session — just show main content and return
  if (_guestPassword) {
    const main = document.getElementById('main-content');
    if (main) main.hidden = false;
    return true;
  }

  const screen = document.getElementById('guest-gate');
  const main = document.getElementById('main-content');
  const form = document.getElementById('guest-form');
  const input = document.getElementById('guest-password-input');
  const feedback = document.getElementById('guest-feedback');
  const btn = document.getElementById('guest-btn');

  if (!screen || !form) return true; // gate elements missing — allow through

  screen.hidden = false;
  main.hidden = true;

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = input.value;
      setFeedback(feedback, null);
      btn.disabled = true;
      btn.textContent = 'A verificar…';

      try {
        const res = await fetch(`${API_BASE}/api/guest/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        if (!res.ok) throw new Error('wrong');

        _guestPassword = password;
        sessionStorage.setItem('guestPassword', password);
        screen.hidden = true;
        main.hidden = false;
        resolve(true);

      } catch {
        setFeedback(feedback, 'error', 'Palavra-passe incorreta. Tenta novamente.');
        input.value = '';
        input.focus();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    });
  });
}

// =============================================================
// NAV — Add shadow on scroll
// =============================================================
(function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const observer = new IntersectionObserver(
    ([entry]) => {
      nav.classList.toggle('scrolled', !entry.isIntersecting);
    },
    { threshold: 0 }
  );
  const hero = document.getElementById('hero');
  if (hero) observer.observe(hero);
})();

// =============================================================
// UTILITIES
// =============================================================

/** Escape HTML to prevent XSS when rendering server data into the DOM. */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fallback when a gift card image fails to load. */
function handleImageError(img) {
  img.parentElement.innerHTML = '<div class="gift-card__image--placeholder" aria-hidden="true">🎁</div>';
}

/**
 * Show/hide form feedback message.
 * @param {HTMLElement} el - The feedback element
 * @param {'success'|'error'|null} type - null to hide
 * @param {string} [msg]
 */
function setFeedback(el, type, msg) {
  el.className = 'form__feedback';
  if (type) {
    el.classList.add(`show--${type}`);
    el.innerHTML = msg ?? '';
  } else {
    el.innerHTML = '';
  }
}

// =============================================================
// GIFT REGISTRY — Fetch and render gift cards
// =============================================================

async function loadGifts() {
  const grid = document.getElementById('gifts-grid');
  const select = document.getElementById('gift-select');
  if (!grid || !select) return;

  grid.innerHTML = '<div class="gifts__loading" role="status" aria-live="polite">A carregar presentes&hellip;</div>';
  // Reset select to first placeholder option
  while (select.options.length > 1) select.remove(1);

  let items = [];
  try {
    const res = await fetch(`${API_BASE}/api/items`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = await res.json();
  } catch (err) {
    grid.innerHTML = '<div class="gifts__loading">Não foi possível carregar os presentes. Por favor atualiza a página ou tenta mais tarde.</div>';
    console.error('Failed to load gift items:', err);
    return;
  }

  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<div class="gifts__loading">A lista de presentes está a ser preparada. Volta em breve!</div>';
    return;
  }

  // Cache items for form hint lookups
  giftItems = items;

  // Sort: generic donation always last (is_generic flag; title match as fallback)
  const GENERIC_DONATION = 'Doação Geral para Mobília/Obras';
  items.sort((a, b) => {
    const aG = a.is_generic === 1 || a.is_generic === true || a.title === GENERIC_DONATION;
    const bG = b.is_generic === 1 || b.is_generic === true || b.title === GENERIC_DONATION;
    if (aG) return 1;
    if (bG) return -1;
    return 0;
  });

  items.forEach((item) => {
    // Render card
    const card = createGiftCard(item);
    grid.appendChild(card);

    // Populate contribution form select
    const option = document.createElement('option');
    option.value = item.id;
    const isFunded = item.is_funded === 1 || item.is_funded === true;
    const isGenericDonation = item.is_generic === 1 || item.is_generic === true;
    option.textContent = isGenericDonation
      ? item.title
      : `${item.title} — €${Number(item.price_total).toFixed(2)}${isFunded ? ' (Totalmente Financiado)' : ''}`;
    if (isFunded) option.disabled = true;
    select.appendChild(option);
  });
}

/**
 * Create a gift card DOM element from an item object.
 * @param {object} item
 * @returns {HTMLElement}
 */
function createGiftCard(item) {
  const isGenericDonation = item.is_generic === 1 || item.is_generic === true;
  const isFunded = item.is_funded === 1 || item.is_funded === true;
  const priceTotal = Number(item.price_total);
  const priceRaised = Number(item.price_raised);
  const pct = priceTotal > 0 ? Math.min(100, Math.round((priceRaised / priceTotal) * 100)) : 0;

  const article = document.createElement('article');
  article.className = `gift-card${isFunded ? ' gift-card--funded' : ''}`;
  article.setAttribute('role', 'listitem');
  article.dataset.itemId = item.id;

  // Build image section
  const imageSection = item.image_url
    ? `<div class="gift-card__image-wrap">
         <img
           class="gift-card__image"
           src="${escHtml(item.image_url)}"
           alt="${escHtml(item.title)}"
           loading="lazy"
         onerror="handleImageError(this)"
         >
       </div>`
    : `<div class="gift-card__image--placeholder" aria-hidden="true">🎁</div>`;

  // Build actions
  const remaining = priceTotal - priceRaised;

  const viewLink = item.product_url && !isGenericDonation
    ? `<a class="btn btn--outline" href="${escHtml(item.product_url)}" target="_blank" rel="noopener noreferrer" aria-label="Ver ${escHtml(item.title)} online">Ver Produto ↗</a>`
    : '';

  const contributeBtn = !isFunded
    ? `<button
         class="btn btn--primary contribute-btn"
         data-item-id="${item.id}"
         data-item-title="${escHtml(item.title)}"
         aria-label="Contribuir para ${escHtml(item.title)}">
         Contribuir
       </button>`
    : `<span class="btn btn--outline" style="pointer-events:none;opacity:0.5;cursor:default;" aria-disabled="true">Financiado ✓</span>`;

  // "Cover full remaining" button — only for priced, non-funded items
  const payFullBtn = !isFunded && !isGenericDonation && remaining > 0
    ? `<button
         class="btn btn--outline pay-full-btn"
         data-item-id="${item.id}"
         data-remaining="${remaining.toFixed(2)}"
         aria-label="Cobrir o valor restante de €${remaining.toFixed(2)} para ${escHtml(item.title)}">
         Cobrir valor restante (€${remaining.toFixed(2)})
       </button>`
    : '';

  article.innerHTML = `
    ${imageSection}
    <div class="gift-card__body">
      ${isFunded ? '<span class="gift-card__funded-badge" aria-label="Totalmente financiado">Totalmente Financiado ✓</span>' : ''}
      <h3 class="gift-card__title">${escHtml(item.title)}</h3>
      ${item.description ? `<p class="gift-card__description">${escHtml(item.description)}</p>` : ''}
      ${!isGenericDonation ? `<p class="gift-card__price">€${priceTotal.toFixed(2)}</p>` : ''}
      ${!isGenericDonation ? `<div class="progress-wrap">
        <div
          class="progress-bar"
          role="progressbar"
          aria-valuenow="${pct}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="${pct}% financiado">
          <div class="progress-bar__fill" style="width:${pct}%"></div>
        </div>
        <p class="progress-text">
          €${priceRaised.toFixed(2)} angariados de €${priceTotal.toFixed(2)}
          <span aria-hidden="true">&nbsp;·&nbsp;</span>
          <strong>${pct}%</strong>
        </p>
      </div>` : ''}
      <div class="gift-card__actions">
        ${viewLink}
        ${contributeBtn}
        ${payFullBtn}
      </div>
    </div>
  `;

  return article;
}

// =============================================================
// CONTRIBUTION FORM
// =============================================================

async function loadMyContributions() {
  const section = document.getElementById('my-contributions-section');
  const list = document.getElementById('my-contributions-list');
  if (!section || !list) return;

  try {
    const res = await fetch(`${API_BASE}/api/my-contributions`, { headers: guestHeaders() });
    if (!res.ok) return;
    const items = await res.json();

    if (items.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    list.innerHTML = items.map(c => `
      <li class="my-contributions__item" data-id="${c.id}">
        <div class="my-contributions__info">
          <strong>${escHtml(c.item_title)}</strong>
          <span>€${Number(c.amount).toFixed(2)}${c.message ? ` · "${escHtml(c.message)}"` : ''}</span>
        </div>
        <button class="my-contributions__delete btn btn--outline btn--sm" data-id="${c.id}">
          Cancelar
        </button>
      </li>
    `).join('');

    list.querySelectorAll('.my-contributions__delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Tens a certeza que queres cancelar esta contribuição?')) return;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const del = await fetch(`${API_BASE}/api/my-contributions/${id}`, {
            method: 'DELETE',
            headers: guestHeaders(),
          });
          if (!del.ok) throw new Error();
          await Promise.all([loadMyContributions(), loadGifts()]);
        } catch {
          btn.disabled = false;
          btn.textContent = 'Cancelar';
        }
      });
    });
  } catch {
    // silently ignore — not critical
  }
}

function initContributionForm() {
  const form = document.getElementById('contribution-form');
  const grid = document.getElementById('gifts-grid');
  const feedback = document.getElementById('form-feedback');
  const submitBtn = document.getElementById('submit-btn');
  if (!form || !feedback || !submitBtn) return;

  // Clicking "Contribuir" pre-fills the select; "Cobrir valor restante" also pre-fills the amount
  grid && grid.addEventListener('click', (e) => {
    const contributeTarget = e.target.closest('.contribute-btn');
    const payFullTarget = e.target.closest('.pay-full-btn');
    const btn = contributeTarget || payFullTarget;
    if (!btn) return;
    const { itemId } = btn.dataset;
    const select = document.getElementById('gift-select');
    if (select) {
      select.value = itemId;
      // Trigger change to update the amount hint
      select.dispatchEvent(new Event('change'));
    }
    if (payFullTarget) {
      const amountInput = document.getElementById('amount-input');
      if (amountInput) amountInput.value = btn.dataset.remaining;
      // Hide hint since we just filled it
      const hint = document.getElementById('amount-hint');
      if (hint) hint.hidden = true;
    }
    document.getElementById('contribute').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const nameInput = document.getElementById('name-input');
      if (nameInput) nameInput.focus();
    }, 400);
  });

  // When select changes, show remaining amount hint + "fill" shortcut
  const selectEl = document.getElementById('gift-select');
  const amountHint = document.getElementById('amount-hint');
  if (selectEl && amountHint) {
    selectEl.addEventListener('change', () => {
      const selectedId = parseInt(selectEl.value, 10);
      amountHint.hidden = true;
      amountHint.innerHTML = '';
      if (!selectedId) return;
      const selectedItem = giftItems.find(i => i.id === selectedId);
      if (!selectedItem || !selectedItem.price_total) return;
      if (selectedItem.is_generic === 1 || selectedItem.is_generic === true) return;
      const isItemFunded = selectedItem.is_funded === 1 || selectedItem.is_funded === true;
      if (isItemFunded) return;
      const itemRemaining = Number(selectedItem.price_total) - Number(selectedItem.price_raised);
      if (itemRemaining <= 0) return;
      amountHint.innerHTML =
        `Valor ainda em falta: <strong>€${itemRemaining.toFixed(2)}</strong> ` +
        `<button type="button" class="form__fill-remaining-btn" data-remaining="${itemRemaining.toFixed(2)}">Preencher automaticamente</button>`;
      amountHint.hidden = false;
      amountHint.querySelector('.form__fill-remaining-btn').addEventListener('click', () => {
        document.getElementById('amount-input').value = itemRemaining.toFixed(2);
        amountHint.hidden = true;
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFeedback(feedback, null);

    const itemId = parseInt(form.item_id.value, 10);
    const contributorName = form.contributor_name.value.trim();
    const amount = parseFloat(form.amount.value);
    const message = form.message.value.trim();

    // Client-side validation
    if (!itemId) {
      setFeedback(feedback, 'error', 'Por favor seleciona um presente da lista.');
      document.getElementById('gift-select').focus();
      return;
    }
    if (!contributorName) {
      setFeedback(feedback, 'error', 'Por favor introduz o teu nome.');
      document.getElementById('name-input').focus();
      return;
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      setFeedback(feedback, 'error', 'Por favor introduz um valor válido (mínimo €1).');
      document.getElementById('amount-input').focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'A enviar…';

    try {
      const res = await fetch(`${API_BASE}/api/contributions`, {
        method: 'POST',
        headers: guestHeaders(),
        body: JSON.stringify({ item_id: itemId, contributor_name: contributorName, amount, message }),
      });

      const json = await res.json();

      if (!res.ok) {
        // Double-booking: amount exceeds remaining — offer to auto-fill the correct amount
        if (res.status === 409 && json.remaining !== undefined) {
          const rem = Number(json.remaining).toFixed(2);
          setFeedback(feedback, 'error',
            `${escHtml(json.error)} ` +
            `<button type="button" class="form__fill-remaining-btn" data-remaining="${rem}">Preencher automaticamente</button>`
          );
          feedback.querySelector('.form__fill-remaining-btn')?.addEventListener('click', () => {
            document.getElementById('amount-input').value = rem;
            setFeedback(feedback, null);
          });
          return;
        }
        // Double-booking: item just got fully funded
        if (res.status === 409) {
          setFeedback(feedback, 'error',
            'Este presente foi entretanto totalmente coberto por outra contribuição. ' +
            'Por favor escolhe outro presente ou atualiza a página.'
          );
          await loadGifts();
          return;
        }
        throw new Error(json.error || `Server error (${res.status})`);
      }

      setFeedback(feedback, 'success', '🎉 Contribuição registada! Para completar, envia o valor via <strong>MB Way</strong> ou fala connosco para mais detalhes. Obrigado! 💚');
      form.reset();

      // Reload gift cards and my contributions
      await Promise.all([loadGifts(), loadMyContributions()]);

      // Scroll back up to registry so they can see the updated card
      document.getElementById('gifts').scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
      setFeedback(feedback, 'error', err.message || 'Ocorreu um erro. Por favor tenta novamente.');
      console.error('Contribution error:', err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Contribuir';
    }
  });
}

// =============================================================
// AI CHATBOT
// =============================================================

function initChatbot() {
  const toggle = document.getElementById('chatbot-toggle');
  const panel = document.getElementById('chatbot-panel');
  const closeBtn = document.getElementById('chatbot-close');
  const chatForm = document.getElementById('chatbot-form');
  const chatInput = document.getElementById('chatbot-input');
  const messages = document.getElementById('chatbot-messages');
  if (!toggle || !panel || !chatForm || !chatInput || !messages) return;

  // Conversation history sent to worker for context
  const chatHistory = [];

  const nudge = document.getElementById('chatbot-nudge');
  const nudgeClose = document.getElementById('chatbot-nudge-close');

  function dismissNudge() {
    if (nudge) nudge.hidden = true;
    toggle.classList.remove('chatbot__toggle--pulse');
  }

  // Show nudge + pulse after 3 s (only if panel not already open)
  setTimeout(() => {
    if (panel.hidden && nudge) {
      nudge.hidden = false;
      toggle.classList.add('chatbot__toggle--pulse');
      // Auto-dismiss after 9 s
      setTimeout(dismissNudge, 9000);
    }
  }, 3000);

  if (nudgeClose) nudgeClose.addEventListener('click', dismissNudge);

  function openPanel() {
    dismissNudge();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Fechar assistente de presentes');
    chatInput.focus();
    scrollMessages();
  }

  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir assistente de presentes');
  }

  toggle.addEventListener('click', () => {
    if (panel.hidden) openPanel(); else closePanel();
  });

  closeBtn.addEventListener('click', closePanel);

  // Close on Escape key
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userMsg = chatInput.value.trim();
    if (!userMsg) return;

    appendMessage('user', escHtml(userMsg));
    chatHistory.push({ role: 'user', content: userMsg });
    chatInput.value = '';
    chatInput.disabled = true;

    const typingEl = appendMessage('typing', 'A pensar…');

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: guestHeaders(),
        body: JSON.stringify({ message: userMsg, history: chatHistory.slice(-10) }),
      });
      const json = await res.json();
      typingEl.remove();
      if (res.status === 429) {
        appendMessage('bot', json.error || 'Limite de mensagens atingido para hoje. Tenta amanhã!');
      } else {
        const botText = json.reply || 'Desculpa, não consegui obter uma resposta agora. Tenta novamente.';
        appendMessage('bot', botText);
        chatHistory.push({ role: 'assistant', content: botText });

        // Contribution confirmation card
        if (json.contribution_pending) {
          appendContributionCard(json.contribution_pending);
        }
        // Cancellation confirmation card
        if (json.cancellation_pending) {
          appendCancellationCard(json.cancellation_pending);
        }
      }
    } catch (err) {
      typingEl.remove();
      appendMessage('bot', 'Estou com dificuldades de ligação. Por favor tenta novamente em breve!');
      console.error('Chat error:', err);
    } finally {
      chatInput.disabled = false;
      chatInput.focus();
    }
  });

  function appendContributionCard(contribution) {
    const card = document.createElement('div');
    card.className = 'chatbot__contribution-card';
    card.innerHTML = `
      <p class="chatbot__contribution-title">Confirmar contribuição</p>
      <ul class="chatbot__contribution-details">
        <li><strong>Presente:</strong> ${escHtml(contribution.item_title)}</li>
        <li><strong>Nome:</strong> ${escHtml(contribution.name)}</li>
        <li><strong>Valor:</strong> €${Number(contribution.amount).toFixed(2)}</li>
        ${contribution.message ? `<li><strong>Mensagem:</strong> ${escHtml(contribution.message)}</li>` : ''}
      </ul>
      <div class="chatbot__contribution-actions">
        <button class="btn btn--primary btn--sm chatbot__confirm-btn">Confirmar ✓</button>
        <button class="btn btn--outline btn--sm chatbot__cancel-btn">Cancelar</button>
      </div>
    `;
    messages.appendChild(card);
    scrollMessages();

    card.querySelector('.chatbot__confirm-btn').addEventListener('click', async () => {
      card.querySelector('.chatbot__contribution-actions').innerHTML =
        '<span style="font-size:var(--text-sm);color:var(--color-text-muted)">A processar…</span>';
      try {
        const res = await fetch(`${API_BASE}/api/contributions`, {
          method: 'POST',
          headers: guestHeaders(),
          body: JSON.stringify({
            item_id: contribution.item_id,
            contributor_name: contribution.name,
            amount: contribution.amount,
            message: contribution.message,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 409 && json.remaining !== undefined) {
            const rem = Number(json.remaining).toFixed(2);
            card.querySelector('.chatbot__contribution-actions').innerHTML =
              `<span style="color:var(--color-error);font-size:var(--text-sm)">${escHtml(json.error)}</span>`;
            chatHistory.length = 0;
            appendMessage('bot',
              `Entretanto, s\u00f3 faltam \u20ac${rem} para cobrir este presente. Quer que registe \u20ac${rem} em vez disso? Se sim, diz-me!`
            );
          } else {
            throw new Error(json.error || 'Erro ao processar');
          }
          return;
        }
        card.querySelector('.chatbot__contribution-actions').innerHTML =
          '<span style="color:var(--color-funded);font-weight:600">\u2713 Contribui\u00e7\u00e3o registada! Obrigado \ud83c\udf81</span>';
        chatHistory.length = 0;
        // MB Way nudge
        appendMessage('bot', `Obrigado! \ud83d\udc9a Para completar, envia \u20ac${Number(contribution.amount).toFixed(2)} via <strong>MB Way</strong> ou fala connosco para mais detalhes. \ud83d\ude0a`);
        await Promise.all([loadGifts(), loadMyContributions()]);
      } catch (err) {
        card.querySelector('.chatbot__contribution-actions').innerHTML =
          `<span style="color:var(--color-error);font-size:var(--text-sm)">${escHtml(err.message)}</span>`;
      }
    });

    card.querySelector('.chatbot__cancel-btn').addEventListener('click', () => {
      card.querySelector('.chatbot__contribution-actions').innerHTML =
        '<span style="font-size:var(--text-sm);color:var(--color-text-muted)">Contribuição cancelada.</span>';
      chatHistory.length = 0;
      appendMessage('bot', 'Sem problema! Se quiseres contribuir mais tarde, usa o botão "Contribuir" em qualquer presente. 😊');
    });
  }

  function appendCancellationCard(cancellation) {
    const card = document.createElement('div');
    card.className = 'chatbot__contribution-card';
    card.innerHTML = `
      <p class="chatbot__contribution-title">Cancelar contribuição</p>
      <ul class="chatbot__contribution-details">
        <li><strong>Presente:</strong> ${escHtml(cancellation.item_title)}</li>
        <li><strong>Valor:</strong> €${Number(cancellation.amount).toFixed(2)}</li>
      </ul>
      <div class="chatbot__contribution-actions">
        <button class="btn btn--primary btn--sm chatbot__confirm-cancel-btn">Confirmar cancelamento</button>
        <button class="btn btn--outline btn--sm chatbot__abort-cancel-btn">Manter contribuição</button>
      </div>
    `;
    messages.appendChild(card);
    scrollMessages();

    card.querySelector('.chatbot__confirm-cancel-btn').addEventListener('click', async () => {
      card.querySelector('.chatbot__contribution-actions').innerHTML =
        '<span style="font-size:var(--text-sm);color:var(--color-text-muted)">A processar…</span>';
      try {
        const res = await fetch(`${API_BASE}/api/my-contributions/${cancellation.contribution_id}`, {
          method: 'DELETE',
          headers: guestHeaders(),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro ao cancelar');
        card.querySelector('.chatbot__contribution-actions').innerHTML =
          '<span style="color:var(--color-funded);font-weight:600">✓ Contribuição cancelada!</span>';
        chatHistory.length = 0;
        await loadGifts();
      } catch (err) {
        card.querySelector('.chatbot__contribution-actions').innerHTML =
          `<span style="color:var(--color-error);font-size:var(--text-sm)">${escHtml(err.message)}</span>`;
      }
    });

    card.querySelector('.chatbot__abort-cancel-btn').addEventListener('click', () => {
      card.querySelector('.chatbot__contribution-actions').innerHTML =
        '<span style="font-size:var(--text-sm);color:var(--color-text-muted)">Cancelamento ignorado. A tua contribuição mantém-se! 🎁</span>';
      chatHistory.length = 0;
    });
  }

  async function showMyContributions() {
    const loadingEl = appendMessage('bot', 'A carregar as tuas contribuições…');
    try {
      const res = await fetch(`${API_BASE}/api/my-contributions`, {
        headers: guestHeaders(),
      });
      loadingEl.remove();
      if (!res.ok) throw new Error();
      const list = await res.json();

      if (list.length === 0) {
        appendMessage('bot', 'Ainda não tens contribuições registadas. Podes contribuir aqui no chat ou pelo botão "Contribuir" em qualquer presente! 🎁');
        return;
      }

      const card = document.createElement('div');
      card.className = 'chatbot__my-contributions-card';
      card.innerHTML = `
        <p class="chatbot__my-contributions-title">As tuas contribuições (${list.length})</p>
        <ul class="chatbot__my-contributions-list">
          ${list.map(c => `
            <li class="chatbot__my-contribution-item" data-id="${c.id}">
              <div class="chatbot__my-contribution-info">
                <strong>${escHtml(c.item_title)}</strong>
                <span>€${Number(c.amount).toFixed(2)}${c.message ? ` · "${escHtml(c.message)}"` : ''}</span>
              </div>
              <button class="chatbot__my-contribution-delete" data-id="${c.id}" aria-label="Cancelar contribuição">Cancelar</button>
            </li>
          `).join('')}
        </ul>
      `;
      messages.appendChild(card);
      scrollMessages();

      card.querySelectorAll('.chatbot__my-contribution-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          btn.disabled = true;
          btn.textContent = '…';
          try {
            const delRes = await fetch(`${API_BASE}/api/my-contributions/${id}`, {
              method: 'DELETE',
              headers: guestHeaders(),
            });
            if (!delRes.ok) throw new Error();
            const li = card.querySelector(`li[data-id="${id}"]`);
            li.innerHTML = '<span style="font-size:var(--text-xs);color:var(--color-text-muted)">✓ Contribuição cancelada.</span>';
            await Promise.all([loadGifts(), loadMyContributions()]);
          } catch {
            btn.disabled = false;
            btn.textContent = 'Cancelar';
            appendMessage('bot', 'Não foi possível cancelar. Tenta novamente.');
          }
        });
      });
    } catch {
      loadingEl.remove();
      appendMessage('bot', 'Não foi possível carregar as contribuições. Tenta novamente.');
    }
  }

  document.getElementById('chatbot-my-contribs')?.addEventListener('click', showMyContributions);

  function appendMessage(type, text) {
    const el = document.createElement('div');
    el.className = `chatbot__message chatbot__message--${type}`;
    el.innerHTML = text;
    messages.appendChild(el);
    scrollMessages();
    return el;
  }

  function scrollMessages() {
    messages.scrollTop = messages.scrollHeight;
  }
}

// =============================================================
// SCROLL SPY — Highlight active nav link
// =============================================================

function initScrollSpy() {
  const sections = document.querySelectorAll('section[id]');
  const links = document.querySelectorAll('.nav__links a');
  if (!sections.length || !links.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          links.forEach((link) => {
            const isActive = link.getAttribute('href') === `#${entry.target.id}`;
            link.style.color = isActive ? 'var(--color-text)' : '';
          });
        }
      });
    },
    { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
  );

  sections.forEach((s) => observer.observe(s));
}

// =============================================================
// INIT
// =============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const authed = await initGuestGate();
  if (!authed) return;

  await loadGifts();
  initContributionForm();
  initChatbot();
  initScrollSpy();
  loadMyContributions(); // non-blocking, shows below form if guest has contributions
});
