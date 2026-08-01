// ============================================================
// ONGLETS — bascule entre les panneaux du panel
// ============================================================

export function initTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('is-active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('is-active');
    });
  });
}
