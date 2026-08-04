// ============================================================
// ADMIN — point d'entrée du panneau d'administration
// Au P'tit Paradis
//
// La logique vit dans js/admin/ : un module par onglet, plus quelques
// modules partagés (ui, icons, uploader). Ce fichier ne fait que câbler
// les écrans au chargement, puis charger les données une fois l'accès
// au panel accordé.
// ============================================================

import { auth } from "./firebase-config.js";
import { initAuth } from "./admin/auth.js";
import { initTabs, appliquerRole } from "./admin/tabs.js";
import { initSettings, loadSettings } from "./admin/settings.js";
import { initBlocks, loadBlocks } from "./admin/blocks.js";
import { initTeam, loadTeam, ROLE_LABELS } from "./admin/team.js";
import { initNoel, loadNoel } from "./admin/noel.js";
import { initOrders, loadOrders, appliquerRoleOrders, entrerModeComptoir, modeJourJVerrouille, ouvrirModeJourJ, demarrerAutoRefresh } from "./admin/orders.js";

initTabs();
initSettings();
initBlocks();
initTeam();
initNoel();
initOrders();

/* Le header affiche qui est connecté : utile dès qu'un même poste sert à
   plusieurs personnes dans la journée (le mode jour J verrouillé, par
   exemple) — on sait d'un coup d'œil quel compte est ouvert. */
function remplirHeader(role, prenom) {
  const nomEl = document.getElementById('topbarNom');
  const roleEl = document.getElementById('topbarRole');
  if (nomEl) nomEl.textContent = prenom || auth.currentUser?.email || '';
  if (roleEl) roleEl.textContent = ROLE_LABELS[role] || role;
}

/* Chaque onglet ne charge ses données que si le rôle y donne droit :
   sinon les règles Firestore refusent la lecture et l'onglet, masqué,
   afficherait quand même son message d'erreur au premier plan. */
initAuth((role, prenom) => {
  remplirHeader(role, prenom);

  // Le comptoir ne voit jamais la barre d'onglets ni les panneaux qu'elle
  // ouvre : il n'a besoin que des commandes, pour le mode jour J.
  if (role === 'comptoir') {
    loadOrders();
    entrerModeComptoir();
    demarrerAutoRefresh();
    return;
  }

  // Ce poste était verrouillé en mode jour J avant un rechargement de
  // page (F5, tirer-pour-actualiser) : on y retourne directement, sans
  // laisser les onglets apparaître ne serait-ce qu'un instant. Le code
  // reste la seule façon d'en sortir, exactement comme avant le
  // rechargement — sinon un simple F5 suffirait à le contourner.
  if (modeJourJVerrouille()) {
    loadOrders();
    ouvrirModeJourJ();
    demarrerAutoRefresh();
    return;
  }

  appliquerRole(role);

  loadSettings();
  loadBlocks();

  if (role === 'superadmin' || role === 'admin') {
    loadTeam();
    loadNoel();
    loadOrders();
    demarrerAutoRefresh();
    // La remise à zéro de la numérotation n'est ouverte qu'au superadmin.
    appliquerRoleOrders(role);
  }
});
