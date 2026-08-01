// ============================================================
// UI — modales, message de statut et petits utilitaires partagés
// ============================================================

/* ---------- Modale de confirmation ----------
   Nommée `confirmDialog` et pas `confirm` : le `confirm` global du navigateur
   reste ainsi accessible, et un import oublié ne se traduit plus par une
   boîte native silencieusement bloquante. */
export function confirmDialog(title, sub) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmSub').textContent = sub;
    document.querySelector('.confirm-actions').style.display = 'flex';
    document.querySelector('.confirm-actions--success').style.display = 'none';
    overlay.hidden = false;

    const ok = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');

    function close(result) {
      overlay.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk = () => close(true);
    const onCancel = () => close(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); }, { once: true });
  });
}

export function showSuccess(title, sub = '') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmSub').textContent = sub;
    document.querySelector('.confirm-actions').style.display = 'none';
    document.querySelector('.confirm-actions--success').style.display = 'flex';
    overlay.hidden = false;

    const closeBtn = document.getElementById('confirmClose');
    function close() {
      overlay.hidden = true;
      closeBtn.removeEventListener('click', close);
      resolve();
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); }, { once: true });
  });
}

/* ---------- Message de statut ---------- */
let statusTimer = null;

export function showStatus(message, isError = false) {
  const statusEl = document.getElementById('adminStatus');
  statusEl.textContent = message;
  statusEl.className = 'admin-status' + (isError ? ' is-error' : '');
  statusEl.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.hidden = true; }, 4000);
}

/* ---------- Champs ---------- */
export function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

export function setVal(id, value) {
  const el = document.getElementById(id);
  if (!el || value === undefined) return;
  el.value = value;
  // les uploaders écoutent 'input' pour rafraîchir leur aperçu
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/* Échappe tout, pas seulement les guillemets : ce helper sert aussi bien dans
   un attribut que dans du texte (`<h3>${escapeAttr(titre)}</h3>`,
   `<textarea>${escapeAttr(desc)}</textarea>`). Un titre de fiche contenant
   `</textarea><img src=x onerror=...>` s'exécutait dans le panel, et donc avec
   la session d'un administrateur — un éditeur pouvait s'en servir pour prendre
   la main. */
export function escapeAttr(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* N'accepte qu'une URL affichable sans risque : une valeur `javascript:...`
   placée dans un href s'exécuterait au clic. */
export function safeUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
  if (/^[./#?]/.test(raw)) return raw;              // chemin relatif ou ancre
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';  // tout autre schéma
  return raw;
}

/* "Horaires" et "Adresse & contact" écrivent tous deux dans la map `horaires` :
   un Object.assign écraserait la première par la seconde. */
export function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] || {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
