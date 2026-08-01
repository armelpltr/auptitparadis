// ============================================================
// auptitparadis-worker — routeur
//
// Deux besoins que le navigateur ne peut pas couvrir seul :
//   POST /delete-user  supprimer le compte Firebase de quelqu'un d'autre
//   POST /order        enregistrer une commande après vérification anti-bot
//
// Les deux passent par la clé de service, qui ne peut pas vivre dans du
// JavaScript servi aux visiteurs. Ce Worker est le seul endroit où elle
// est à l'abri.
// ============================================================

import { corsHeaders, json } from './http.js';
import { handleDeleteUser } from './admin-delete.js';
import { handleOrder } from './orders.js';

const ROUTES = {
  '/delete-user': handleDeleteUser,
  '/order': handleOrder,
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
