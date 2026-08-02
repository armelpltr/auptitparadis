// ============================================================
// auptitparadis-worker — routeur
//
// Ce que le navigateur ne peut pas couvrir seul :
//   POST /delete-user   supprimer le compte Firebase de quelqu'un d'autre
//   POST /order         enregistrer une commande après vérification anti-bot
//   POST /order/manage  relire une commande depuis le lien reçu par e-mail
//   POST /order/cancel  l'annuler tant que le délai le permet
//
// Les deux passent par la clé de service, qui ne peut pas vivre dans du
// JavaScript servi aux visiteurs. Ce Worker est le seul endroit où elle
// est à l'abri.
// ============================================================

import { corsHeaders, json } from './http.js';
import { handleDeleteUser } from './admin-delete.js';
import { handleOrder } from './orders.js';
import { handleOrderManage, handleOrderCancel } from './order-manage.js';
import { handleA2fRequest, handleA2fVerify } from './a2f.js';

const ROUTES = {
  '/delete-user': handleDeleteUser,
  '/order': handleOrder,
  '/order/manage': handleOrderManage,
  '/order/cancel': handleOrderCancel,
  '/a2f/request': handleA2fRequest,
  '/a2f/verify': handleA2fVerify,
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const handler = ROUTES[new URL(request.url).pathname];
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
};
