// ============================================================
// POST /order — réservation d'une commande de Noël
//
// Le formulaire public n'écrit pas dans Firestore : les règles interdisent
// la création de commandes, et c'est voulu. Elles ne peuvent pas appeler
// l'API de Cloudflare, donc un formulaire écrivant en direct rendrait la
// vérification anti-bot purement décorative.
//
//   1. piège à bots (champ caché) — accepté en apparence, jamais écrit
//   2. jeton Turnstile vérifié auprès de Cloudflare
//   3. commandes ouvertes ? date de retrait dans la période annoncée ?
//   4. coordonnées validées, produits et prix relus depuis le catalogue
//   5. réservation déjà en cours pour ce numéro ? on ne double pas
//   6. code de confirmation, écriture, renvoi du code au client
// ============================================================

import { json, httpError } from './http.js';
import {
  firestoreGet, firestoreList, firestoreCreate, firestoreQueryByField, fromFirestoreFields
} from './firebase.js';
import { envoyerConfirmation } from './mailer.js';

const MAX_LIGNES        = 10;   // produits distincts dans une même commande
const MAX_QUANTITE      = 20;   // exemplaires d'un même produit
const FENETRE_DOUBLON_H = 24;   // au-delà, un même numéro peut recommander

// Garde-fou sur le délai d'annulation saisi dans le panel : au-delà, la
// valeur relève de la faute de frappe plus que du choix.
const DELAI_ANNULATION_MAX_JOURS = 60;

/* Alphabet sans O/0, I/1, S/5, B/8, Z/2 : le code est lu à voix haute au
   comptoir et recopié à la main. */
const ALPHABET_CODE = 'ACDEFGHJKLMNPQRTUVWXY34679';

function genererCode(longueur = 6) {
  const octets = crypto.getRandomValues(new Uint8Array(longueur));
  return Array.from(octets, o => ALPHABET_CODE[o % ALPHABET_CODE.length]).join('');
}

/* ---------- Validation des champs libres ---------- */

function texte(v, { min = 0, max, champ }) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw httpError(`${champ} est trop court.`, 400);
  if (s.length > max) throw httpError(`${champ} est trop long (${max} caractères maximum).`, 400);
  return s;
}

/* On stocke une forme unique (0XXXXXXXXX) : c'est elle qui sert à repérer
   les doublons, et « 06 12 … » ne doit pas passer pour un autre numéro que
   « +336 12 … ». */
function telephoneFr(v) {
  const brut = String(v ?? '').replace(/[\s.\-()]/g, '');
  const normalise = brut.startsWith('+33') ? '0' + brut.slice(3)
                  : brut.startsWith('0033') ? '0' + brut.slice(4)
                  : brut;
  if (!/^0[1-9]\d{8}$/.test(normalise)) {
    throw httpError('Numéro de téléphone invalide. Exemple : 06 12 34 56 78', 400);
  }
  return normalise;
}

/* Obligatoire : c'est par là que partira la confirmation de réservation. */
function email(v) {
  const s = String(v ?? '').trim();
  if (!s) throw httpError("Merci d'indiquer une adresse e-mail.", 400);
  if (s.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    throw httpError('Adresse e-mail invalide.', 400);
  }
  return s;
}

function dateIso(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw httpError('Date de retrait invalide.', 400);
  return s;
}

/* ---------- Turnstile ---------- */

async function verifierTurnstile(token, request, env) {
  // Pas de secret configuré = pas de vérification possible. On refuse plutôt
  // que d'accepter : un endpoint d'écriture ouvert se remplit vite.
  if (!env.TURNSTILE_SECRET) {
    throw httpError("La vérification anti-robot n'est pas configurée sur le serveur.", 503);
  }
  if (!token) throw httpError('Vérification anti-robot manquante.', 400);

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    throw httpError('Vérification anti-robot échouée. Rechargez la page et réessayez.', 403);
  }
}

/* ---------- Période de commande ---------- */

async function lirePeriode(env) {
  const doc = await firestoreGet('settings/noel', env).catch(() => null);
  const s = doc ? fromFirestoreFields(doc.fields) : {};
  if (s.ouvert !== true) {
    throw httpError("Les commandes de Noël ne sont pas ouvertes pour le moment.", 409);
  }
  if (!s.dateDebut || !s.dateFin) {
    throw httpError("La période de retrait n'est pas encore définie.", 409);
  }
  return {
    dateDebut: s.dateDebut,
    dateFin: s.dateFin,
    delaiAnnulationJours: normaliserDelai(s.delaiAnnulationJours)
  };
}

/* Le réglage vient du panel : on le borne ici plutôt que de faire confiance
   à ce qui est en base. 0 (ou absent) = pas d'annulation en ligne. */
function normaliserDelai(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), DELAI_ANNULATION_MAX_JOURS);
}

/* La date limite est calculée à la commande et gravée dans le document,
   pas recalculée à chaque lecture : le client a reçu une date par e-mail,
   elle ne doit pas bouger si la boulangerie change son réglage ensuite. */
function calculerLimiteAnnulation(delaiJours, dateRetrait, maintenant) {
  if (!delaiJours) return null;

  const parDelai = maintenant.getTime() + delaiJours * 86400000;
  // Jamais au-delà du début du jour de retrait : une bûche annulée le matin
  // même est déjà faite. La période de commande est en décembre, donc
  // toujours en heure d'hiver — d'où le +01:00 en dur.
  const debutRetrait = Date.parse(`${dateRetrait}T00:00:00+01:00`);

  const limite = Math.min(parDelai, debutRetrait);
  // Commande passée la veille au soir pour le lendemain : la limite serait
  // déjà dépassée. Mieux vaut ne rien promettre.
  return limite > maintenant.getTime() ? new Date(limite) : null;
}

/* ---------- Lignes de commande ---------- */
/* Les prix envoyés par le navigateur sont ignorés : on relit le catalogue.
   Sinon il suffirait de modifier la requête pour réserver une bûche à 1 €. */
async function construireLignes(items, env) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError('Votre panier est vide.', 400);
  }
  if (items.length > MAX_LIGNES) {
    throw httpError(`Trop de produits différents (${MAX_LIGNES} maximum).`, 400);
  }

  const catalogue = await firestoreList('noel_produits', env);
  const vus = new Set();
  let total = 0;

  const lignes = items.map(item => {
    const id = String(item?.id ?? '');
    if (vus.has(id)) throw httpError('Un même produit apparaît deux fois dans le panier.', 400);
    vus.add(id);

    const produit = catalogue.find(p => p.id === id);
    if (!produit) throw httpError("Un produit du panier n'existe plus au catalogue.", 409);
    if (produit.disponible === false) {
      throw httpError(`« ${produit.nom} » n'est plus disponible.`, 409);
    }

    const quantite = Number(item?.quantite);
    if (!Number.isInteger(quantite) || quantite < 1 || quantite > MAX_QUANTITE) {
      throw httpError(`Quantité invalide pour « ${produit.nom} » (1 à ${MAX_QUANTITE}).`, 400);
    }

    const prixUnitaire = Number(produit.prix) || 0;
    total += prixUnitaire * quantite;

    // Le nom et le prix sont recopiés dans la commande : le catalogue changera,
    // la commande doit rester lisible telle qu'elle a été passée.
    return { produitId: id, nom: produit.nom || '', prixUnitaire, quantite };
  });

  return { lignes, total: Math.round(total * 100) / 100 };
}

/* ---------- Doublons ---------- */
/* Requête sur le seul téléphone : croiser deux champs obligerait à créer un
   index composite dans la console, et son oubli ne se verrait qu'en
   production. Le tri sur le statut se fait ici. */
async function reservationEnCours(telephone, env) {
  const existantes = await firestoreQueryByField('orders', 'client.telephone', telephone, env);
  const limite = Date.now() - FENETRE_DOUBLON_H * 3600 * 1000;

  return existantes.find(o =>
    ['en_attente', 'confirmee'].includes(o.statut) &&
    Date.parse(o.createdAt || '') > limite
  ) || null;
}

/* ---------- Route ---------- */

export async function handleOrder(request, env, cors) {
  const body = await request.json().catch(() => {
    throw httpError('Requête illisible.', 400);
  });

  // Piège à bots : un humain ne voit pas ce champ, donc ne le remplit pas.
  // Réponse d'apparence normale — signaler le piège apprendrait à l'éviter.
  if (String(body.website ?? '').trim() !== '') {
    return json({ ok: true, code: genererCode() }, 200, cors);
  }

  await verifierTurnstile(body.turnstileToken, request, env);

  const periode = await lirePeriode(env);
  const dateRetrait = dateIso(body.dateRetrait);
  if (dateRetrait < periode.dateDebut || dateRetrait > periode.dateFin) {
    throw httpError('La date de retrait est en dehors de la période proposée.', 400);
  }

  const prenom = texte(body.client?.prenom, { min: 2, max: 40, champ: 'Le prénom' });
  const nom    = texte(body.client?.nom,    { min: 2, max: 40, champ: 'Le nom' });
  const client = {
    prenom,
    nom,
    // Recopié complet : l'admin et les futurs e-mails l'affichent tel quel,
    // sans avoir à recoller les deux morceaux à chaque fois.
    nomComplet: `${prenom} ${nom}`,
    telephone: telephoneFr(body.client?.telephone),
    email:     email(body.client?.email)
  };
  const commentaire = texte(body.commentaire, { max: 300, champ: 'Le commentaire' });

  const doublon = await reservationEnCours(client.telephone, env);
  if (doublon) {
    return json({
      error: 'Une réservation est déjà en cours avec ce numéro de téléphone.',
      duplicate: true,
      code: doublon.code || ''
    }, 409, cors);
  }

  const { lignes, total } = await construireLignes(body.items, env);
  const code = genererCode();
  const maintenant = new Date();

  /* Jeton de gestion : c'est lui, et lui seul, qui donne accès à la
     commande depuis l'e-mail. Il ne sert pas à s'authentifier auprès de
     Firestore — les règles y interdisent toujours toute lecture publique —
     mais à retrouver la commande côté Worker. Un UUID v4 : 122 bits, hors
     de portée d'une énumération. */
  const manageToken = crypto.randomUUID();
  const annulableJusqua = calculerLimiteAnnulation(
    periode.delaiAnnulationJours, dateRetrait, maintenant
  );

  const commande = {
    code,
    statut: 'en_attente',
    client,
    items: lignes,
    total,
    dateRetrait,
    commentaire,
    manageToken,
    annulableJusqua
  };

  await firestoreCreate('orders', { ...commande, createdAt: maintenant }, env);

  // Après l'écriture, et sans pouvoir la remettre en cause : une commande
  // enregistrée dont l'e-mail échoue reste une commande valable.
  const emailEnvoye = await envoyerConfirmation(commande, env);

  return json({ ok: true, code, total, dateRetrait, emailEnvoye, email: client.email }, 200, cors);
}
