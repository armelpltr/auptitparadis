// ============================================================
// ONGLETS — bascule entre les panneaux du panel
// ============================================================

/* Onglets ouverts à chaque rôle. Le rôle « réglages du site » ne voit ni
   les commandes — qui portent les coordonnées de clients — ni le catalogue
   de Noël, ni les accès.
   Ce n'est qu'un habillage : ce sont les règles Firestore qui refusent
   réellement les lectures et les écritures. Masquer les onglets évite
   surtout d'afficher des pages qui échoueraient. */
const ONGLETS_PAR_ROLE = {
  superadmin: ['settings', 'orders', 'noel', 'team'],
  admin:      ['settings', 'orders', 'noel', 'team'],
  editor:     ['settings']
};

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

/** Masque les onglets fermés au rôle, et bascule sur le premier ouvert. */
export function appliquerRole(role) {
  const permis = ONGLETS_PAR_ROLE[role] || ONGLETS_PAR_ROLE.editor;
  let actifVisible = false;

  document.querySelectorAll('.admin-tab').forEach(tab => {
    const ouvert = permis.includes(tab.dataset.tab);
    tab.hidden = !ouvert;
    if (ouvert && tab.classList.contains('is-active')) actifVisible = true;
  });

  // L'onglet actif par défaut peut être fermé à ce rôle : on ouvre le premier
  // auquel il a droit plutôt que de laisser un panneau vide.
  if (!actifVisible) {
    const premier = document.querySelector(`.admin-tab[data-tab="${permis[0]}"]`);
    if (premier) premier.click();
  }
}
