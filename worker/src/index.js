// ============================================================
// auptitparadis-worker — routeur
//
// Ce que le navigateur ne peut pas couvrir seul :
//   POST /delete-user    supprimer le compte Firebase de quelqu'un d'autre
//   POST /order          enregistrer une commande après vérification anti-bot
//   POST /order/manage   relire une commande depuis le lien reçu par e-mail
//   POST /order/cancel   l'annuler tant que le délai le permet
//   POST /invite/accept  créer un accès à partir d'une invitation, ce qui
//                        permet de fermer l'inscription publique
//   POST /jourj/code     poser et vérifier le code de sortie du mode jour J,
//                        rangé hors de portée des règles Firestore
//   POST /image          recevoir une photo du panel et la ranger dans R2
//   GET  /image/<clé>    la servir, avec un cache long
//
// Et une tâche planifiée : la purge des commandes dont la durée de
// conservation est passée.
//
// Toutes passent par la clé de service, qui ne peut pas vivre dans du
// JavaScript servi aux visiteurs. Ce Worker est le seul endroit où elle
// est à l'abri — et, corollaire à ne jamais perdre de vue, le seul que
// les règles Firestore ne protègent pas : elle les contourne. Chaque
// route refait donc les vérifications elle-même, via membre.js.
// ============================================================

import { corsHeaders, json } from './http.js';
import { handleDeleteUser } from './admin-delete.js';
import { handleOrder } from './orders.js';
import { handleOrderManage, handleOrderCancel } from './order-manage.js';
import { handleA2fRequest, handleA2fVerify } from './a2f.js';
import { handleInviteAccept } from './invite-accept.js';
import { handleJourJCode } from './jourj.js';
import { handleImageUpload, handleImageGet } from './images.js';
import { purgerCommandes } from './purge.js';

const ROUTES = {
  '/delete-user': handleDeleteUser,
  '/order': handleOrder,
  '/order/manage': handleOrderManage,
  '/order/cancel': handleOrderCancel,
  '/a2f/request': handleA2fRequest,
  '/a2f/verify': handleA2fVerify,
  '/invite/accept': handleInviteAccept,
  '/jourj/code': handleJourJCode,
  '/image': handleImageUpload,
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    const chemin = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    /* Seule route en lecture, et la seule dont le chemin porte une valeur
       variable : elle est traitée à part, avant la table des routes qui
       n'accepte que des chemins exacts et la méthode POST. Une balise
       <img> ne demande pas de CORS, d'où l'absence d'en-têtes ici. */
    if (chemin.startsWith('/image/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Méthode non autorisée' }, 405, cors);
      }
      try {
        return await handleImageGet(request, env);
      } catch (err) {
        console.error('Image illisible :', err);
        return new Response('Not found', { status: 404 });
      }
    }

    const handler = ROUTES[chemin];
    if (!handler) return json({ error: 'Not found' }, 404, cors);
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, cors);

    try {
      return await handler(request, env, cors);
    } catch (err) {
      const status = err.status || 500;
      // Les messages métier sont écrits pour être lus par le client ; une
      // erreur inattendue ne doit pas laisser fuiter le détail interne.
      const message = err.status ? err.message : 'Erreur serveur';
      if (!err.status) console.error('Erreur non gérée :', err);
      return json({ error: message }, status, cors);
    }
  },

  /* Purge nocturne des commandes hors durée de conservation. Le cron est
     déclaré dans wrangler.toml. `waitUntil` n'est pas nécessaire ici : le
     runtime attend la promesse rendue par `scheduled`. */
  async scheduled(event, env, ctx) {
    await purgerCommandes(env);
  },
};
