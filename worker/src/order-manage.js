// ============================================================
// POST /order/manage  — consulter sa commande depuis l'e-mail
// POST /order/cancel  — l'annuler, tant que le délai le permet
//
// Les règles Firestore n'ouvrent `orders` à personne d'autre qu'un membre
// du panel, et cela ne change pas : le client ne lit pas sa commande, il la
// demande au Worker, qui la relit avec la clé de service. Le seul secret en
// jeu est le jeton reçu par e-mail.
//
// Le jeton voyage dans le corps de la requête et non dans le chemin : une
// URL se retrouve dans les journaux d'accès, un corps de POST beaucoup
// moins.
// ============================================================

import { json, httpError } from './http.js';
import { firestoreQueryByField, firestoreUpdate } from './firebase.js';
import { envoyerAnnulation } from './mailer.js';

/* Statuts qu'on ne peut plus annuler en ligne : la commande est soit déjà
   partie, soit déjà annulée. « Prête » reste annulable — c'est justement le
   moment où un client se décommande, et la boulangerie préfère le savoir. */
const STATUTS_FIGES = ['recuperee', 'annulee'];

function lireJeton(body) {
  const t = String(body?.token ?? '').trim();
  // Format d'UUID : un jeton qui n'y ressemble pas ne peut pas exister en
  // base, autant ne pas interroger Firestore pour rien.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    throw httpError('Lien de gestion invalide.', 400);
  }
  return t;
}

async function trouverParJeton(token, env) {
  const trouvees = await firestoreQueryByField('orders', 'manageToken', token, env, 1);
  if (!trouvees.length) {
    // Même message que pour un jeton mal formé : distinguer « inexistant »
    // de « existe mais pas à vous » n'apprendrait rien d'utile à un client
    // légitime, et beaucoup à qui tâtonne.
    throw httpError('Cette commande est introuvable. Le lien a peut-être expiré.', 404);
  }
  return trouvees[0];
}

/* Ce qu'on accepte de renvoyer au porteur du lien. Le téléphone et
   l'adresse e-mail restent en base : la commande est déjà identifiée par
   son code, les réafficher n'ajoute rien et les expose si le lien traîne
   dans une boîte partagée. */
function vuePublique(commande) {
  const limite = commande.annulableJusqua || null;
  const fige = STATUTS_FIGES.includes(commande.statut);
  const delaiPasse = !limite || Date.parse(limite) <= Date.now();

  return {
    code: commande.code || '',
    statut: commande.statut || 'en_attente',
    prenom: commande.client?.prenom || '',
    dateRetrait: commande.dateRetrait || '',
    heureRetrait: commande.heureRetrait || '',
    items: (commande.items || []).map(it => ({
      nom: it.nom, quantite: it.quantite, prixUnitaire: it.prixUnitaire
    })),
    total: commande.total || 0,
    commentaire: commande.commentaire || '',
    annulableJusqua: limite,
    annulable: !fige && !delaiPasse,
    // Pourquoi le bouton n'est pas là : sans ça, une page qui affiche
    // simplement « annulation impossible » laisse le client sans recours.
    raison: fige ? commande.statut : (delaiPasse ? 'delai_depasse' : null)
  };
}

export async function handleOrderManage(request, env, cors) {
  const body = await request.json().catch(() => {
    throw httpError('Requête illisible.', 400);
  });
  const commande = await trouverParJeton(lireJeton(body), env);
  return json({ ok: true, commande: vuePublique(commande) }, 200, cors);
}

export async function handleOrderCancel(request, env, cors) {
  const body = await request.json().catch(() => {
    throw httpError('Requête illisible.', 400);
  });
  const commande = await trouverParJeton(lireJeton(body), env);

  // Déjà annulée : on renvoie l'état plutôt qu'une erreur. Un double clic,
  // ou un lien rouvert plus tard, n'est pas une faute du client.
  if (commande.statut === 'annulee') {
    return json({ ok: true, dejaAnnulee: true, commande: vuePublique(commande) }, 200, cors);
  }
  if (commande.statut === 'recuperee') {
    throw httpError('Cette commande a déjà été récupérée en boutique.', 409);
  }

  const limite = commande.annulableJusqua;
  if (!limite || Date.parse(limite) <= Date.now()) {
    throw httpError(
      "Le délai d'annulation en ligne est passé. Appelez-nous, on trouvera une solution.",
      409
    );
  }

  await firestoreUpdate(`orders/${commande.id}`, {
    statut: 'annulee',
    annuleeLe: new Date(),
    // Qui a annulé : le panel affiche « annulée par le client », pour que
    // personne ne se demande si c'est un collègue qui a cliqué.
    annuleePar: 'client'
  }, env);

  const misAJour = { ...commande, statut: 'annulee' };

  // Comme pour la confirmation : l'annulation est enregistrée, un e-mail
  // qui ne part pas ne la remet pas en cause.
  await envoyerAnnulation(misAJour, env);

  return json({ ok: true, commande: vuePublique(misAJour) }, 200, cors);
}
