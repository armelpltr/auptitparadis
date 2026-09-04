// ============================================================
// POST /jourj/code — le code qui fait sortir du mode jour J
//
// Il vivait dans `settings/noel`, dont les règles portent
// `allow read: if true` pour que le site public lise les dates de retrait.
// Le code de sortie était donc lisible par n'importe qui, sans compte :
//
//   GET .../documents/settings/noel?key=<clé publique du projet>
//
// et sa valeur par défaut était en clair dans du JavaScript servi à tous.
// La comparaison se faisait dans le navigateur, ce qui n'arrangeait rien.
//
// Il vit maintenant dans `panelSecrets/jourj`, une collection qu'aucune
// règle n'autorise — donc fermée à tous les clients, y compris connectés,
// puisque les règles refusent par défaut ce qu'elles n'ouvrent pas. Seul ce
// Worker y accède, par la clé de service. Et il n'y est pas en clair : salé
// et haché, comme les codes de double authentification.
//
// Ce que ce verrou protège, et ce qu'il ne protège pas : l'écran du
// comptoir tourne avec la session d'un administrateur, donc quiconque
// atteint les outils de développement de la tablette contourne l'affichage
// quoi qu'on fasse. Le code empêche l'employé de sortir du mode par un
// simple tap — il n'a jamais été une frontière d'authentification.
// ============================================================

import { json, httpError } from './http.js';
import { membreOuRefus } from './membre.js';
import {
  firestoreGet, firestoreSet, firestoreIncrement, fromFirestoreFields
} from './firebase.js';

const CHEMIN_CODE    = 'panelSecrets/jourj';
const MAX_ESSAIS     = 10;                // essais par fenêtre
const FENETRE_MS     = 15 * 60 * 1000;    // durée de la fenêtre

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/* Comparaison à durée constante : un `===` sort au premier caractère
   différent, et ce temps de réponse renseigne sur le début de la valeur. */
function memeValeur(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function codeValide(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}$/.test(s)) throw httpError('Le code doit comporter exactement 4 chiffres.', 400);
  return s;
}

async function lireConfig(env) {
  try {
    const doc = await firestoreGet(CHEMIN_CODE, env);
    return fromFirestoreFields(doc.fields);
  } catch {
    return null;
  }
}

/* Quatre chiffres se parcourent en dix mille essais. Sans plafond, la
   vérification côté serveur ne vaudrait pas mieux que celle qu'elle
   remplace.

   La fenêtre est portée par le NOM du document (`<uid>_<numéro de
   fenêtre>`), et non par un champ qu'on remet à zéro. La version
   précédente relisait le compteur, constatait la fenêtre écoulée et
   réécrivait `attempts: 0` avant d'incrémenter : deux requêtes simultanées
   passaient toutes les deux par cette remise à zéro, et le plafond qu'on
   venait de poser retombait à zéro à chaque paire. Un document par
   fenêtre n'a rien à remettre à zéro — il ne reste que l'incrément, qui
   lui est atomique.

   Le compteur reste incrémenté AVANT la comparaison : un essai qui
   n'aboutit pas doit coûter autant qu'un essai juste. */
async function compterEssai(uid, env) {
  const maintenant = Date.now();
  const fenetre = Math.floor(maintenant / FENETRE_MS);
  const chemin = `jourjEssais/${uid}_${fenetre}`;

  let essais;
  try {
    essais = await firestoreIncrement(chemin, 'attempts', env);
  } catch {
    /* Un `transform` seul n'ouvre pas un document absent : la première
       tentative de la fenêtre le crée. `expireLe` sert à la purge
       nocturne, qui balaie ces compteurs une fois leur fenêtre passée. */
    await firestoreSet(chemin, {
      attempts: 1,
      expireLe: new Date(maintenant + FENETRE_MS)
    }, env);
    essais = 1;
  }

  if (essais > MAX_ESSAIS) {
    throw httpError("Trop de tentatives. Réessayez dans un quart d'heure.", 429);
  }
}

export async function handleJourJCode(request, env, cors) {
  const body = await request.json().catch(() => {
    throw httpError('Requête illisible.', 400);
  });

  const action = String(body.action ?? '');

  /* Définir le code relève de la gestion de la boutique, pas du comptoir :
     même exigence que `settings/noel` dans les règles. Les deux autres
     actions restent ouvertes à tout membre — le comptoir doit pouvoir
     sortir du mode, et le panel connaître l'état du réglage. */
  const { uid } = await membreOuRefus(body.idToken, env, { gestion: action === 'definir' });

  if (action === 'definir') {
    const code = codeValide(body.code);
    const sel = crypto.randomUUID();
    await firestoreSet(CHEMIN_CODE, {
      sel,
      codeHash: await sha256(sel + code),
      majLe: new Date(),
      majPar: uid
    }, env);
    return json({ ok: true }, 200, cors);
  }

  // Le panel affiche « aucun code défini » plutôt que quatre puces trompeuses.
  if (action === 'etat') {
    const config = await lireConfig(env);
    return json({ ok: true, configure: Boolean(config?.codeHash) }, 200, cors);
  }

  if (action === 'verifier') {
    const config = await lireConfig(env);

    /* Aucun code défini : on laisse sortir, et on le dit. Un verrou dont
       personne ne connaît la combinaison enferme la personne au comptoir
       sans rien protéger de plus — l'ancien défaut était publié dans le
       JavaScript du site, il ne fermait rien non plus. */
    if (!config?.codeHash) {
      return json({ ok: true, nonConfigure: true }, 200, cors);
    }

    await compterEssai(uid, env);
    const code = codeValide(body.code);
    const attendu = await sha256((config.sel || '') + code);
    return json({ ok: memeValeur(attendu, config.codeHash) }, 200, cors);
  }

  throw httpError('Action inconnue.', 400);
}
