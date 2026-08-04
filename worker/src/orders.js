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
  firestoreGet, firestoreList, firestoreCreate, firestoreQueryByField, fromFirestoreFields,
  firestoreIncrement, firestoreSet
} from './firebase.js';
import { envoyerConfirmation } from './mailer.js';

const MAX_LIGNES        = 10;   // produits distincts dans une même commande
const MAX_QUANTITE      = 20;   // exemplaires d'un même produit
const FENETRE_DOUBLON_H = 24;   // au-delà, un même numéro peut recommander

// Garde-fou sur le délai d'annulation saisi dans le panel : au-delà, la
// valeur relève de la faute de frappe plus que du choix.
const DELAI_ANNULATION_MAX_JOURS = 60;

/* Le code n'est plus un tirage aléatoire : c'est un numéro de commande,
   lisible et attendu comme tel (« SITE0001 », « SITE0002 »...). Le compteur
   vit dans un document dédié, incrémenté côté serveur en une seule
   opération — deux commandes arrivées en même temps ne peuvent pas
   recevoir le même numéro. */
const PREFIXE_CODE = 'SITE';
const COMPTEUR_PATH = 'compteurs/commandes';
const COMPTEUR_CHAMP = 'dernier';

async function prochainNumero(env) {
  try {
    return await firestoreIncrement(COMPTEUR_PATH, COMPTEUR_CHAMP, env);
  } catch {
    // Le transform seul exige un document déjà existant : la toute
    // première commande le crée, les suivantes retombent sur l'incrément.
    await firestoreSet(COMPTEUR_PATH, { [COMPTEUR_CHAMP]: 1 }, env);
    return 1;
  }
}

async function genererCode(env) {
  const numero = await prochainNumero(env);
  return `${PREFIXE_CODE}${String(numero).padStart(4, '0')}`;
}

/* Réponse du piège à bots : un code plausible, sans toucher au compteur
   réel — aucune commande n'est créée, ce numéro ne doit exister nulle
   part. */
function codeFactice() {
  return `${PREFIXE_CODE}${String(Math.floor(1000 + Math.random() * 9000))}`;
}

/* ---------- Validation des champs libres ---------- */

/* Refuse les caractères de contrôle. Seul le commentaire garde le saut de
   ligne : un prénom en portant un traversait jusqu'à l'objet des e-mails.
   Écrit en points de code plutôt qu'en classe de caractères, où les
   échappements se lisent mal et se recopient plus mal encore. */
function contientControle(s, autoriserSautLigne) {
  for (const c of s) {
    const p = c.codePointAt(0);
    if (p === 10 && autoriserSautLigne) continue;
    if (p < 32 || (p >= 127 && p <= 159)) return true;
  }
  return false;
}

function texte(v, { min = 0, max, champ, multiligne = false }) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw httpError(`${champ} est trop court.`, 400);
  if (s.length > max) throw httpError(`${champ} est trop long (${max} caractères maximum).`, 400);

  if (contientControle(s, multiligne)) {
    throw httpError(`${champ} contient des caractères interdits.`, 400);
  }
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

/* L'heure envoyée par le navigateur est revérifiée ici : le formulaire ne
   propose que des créneaux valables, mais rien n'oblige un client à passer
   par le formulaire. Sans plage réglée, la commande n'a pas d'heure et n'en
   attend pas — c'est l'état des commandes passées avant cette option. */
function heureCreneau(v, periode) {
  const s = String(v ?? '').trim();
  if (!periode.heureDebut || !periode.heureFin) return '';

  if (!/^\d{2}:\d{2}$/.test(s)) throw httpError('Heure de retrait invalide.', 400);
  if (s < periode.heureDebut || s > periode.heureFin) {
    throw httpError("L'heure de retrait est en dehors des créneaux proposés.", 400);
  }

  const pas = [15, 30, 60].includes(Number(periode.pasCreneauMinutes))
    ? Number(periode.pasCreneauMinutes) : 30;
  const [h, m] = s.split(':').map(Number);
  const [hd, md] = periode.heureDebut.split(':').map(Number);
  if (h > 23 || m > 59 || (h * 60 + m - (hd * 60 + md)) % pas !== 0) {
    throw httpError("L'heure de retrait ne correspond à aucun créneau proposé.", 400);
  }
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
/* Une limite ne vaut que si elle compte tout le monde : les commandes
   d'autres clients pour la même date de retrait, tous statuts sauf
   annulée — une commande encore « en attente » réserve la part qu'elle
   demande, sinon la limite ne protégerait rien contre deux personnes qui
   commandent au même instant. */
async function quantitesReservees(dateRetrait, env) {
  /* La limite plafonne ce qui est compté, donc ce qui est protégé : au-delà,
     les commandes suivantes ne sont pas vues et la capacité se dépasse en
     silence. 2000 met la borne hors d'atteinte pour une boulangerie — un
     seul jour de retrait n'en verra pas autant — sans ouvrir une lecture
     sans fin. Si ce chiffre devenait atteignable, il faudrait paginer plutôt
     que le relever encore. */
  const commandes = await firestoreQueryByField('orders', 'dateRetrait', dateRetrait, env, 2000);
  const parProduit = new Map();
  for (const o of commandes) {
    if (o.statut === 'annulee') continue;
    for (const it of (o.items || [])) {
      parProduit.set(it.produitId, (parProduit.get(it.produitId) || 0) + (it.quantite || 0));
    }
  }
  return parProduit;
}

async function construireLignes(items, dateRetrait, env) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError('Votre panier est vide.', 400);
  }
  if (items.length > MAX_LIGNES) {
    throw httpError(`Trop de produits différents (${MAX_LIGNES} maximum).`, 400);
  }

  const catalogue = await firestoreList('noel_produits', env);
  const vus = new Set();
  let total = 0;

  // Uniquement calculé si au moins un produit du panier porte une limite
  // pour CETTE date précise : pas la peine d'interroger les commandes du
  // jour pour un produit dont la limite ne concerne pas cette date-là.
  const aUneLimite = items.some(item => {
    const p = catalogue.find(pp => pp.id === String(item?.id ?? ''));
    const limite = p?.capacites?.[dateRetrait];
    return Number.isInteger(limite) && limite > 0;
  });
  const dejaReserve = aUneLimite ? await quantitesReservees(dateRetrait, env) : new Map();

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

    const capacite = produit.capacites?.[dateRetrait];
    if (Number.isInteger(capacite) && capacite > 0) {
      const dejaPris = dejaReserve.get(id) || 0;
      const restant = capacite - dejaPris;
      if (quantite > restant) {
        throw httpError(
          restant > 0
            ? `Il ne reste que ${restant} « ${produit.nom} » disponible${restant > 1 ? 's' : ''} pour cette date de retrait.`
            : `« ${produit.nom} » est complet pour cette date de retrait.`,
          409
        );
      }
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
    return json({ ok: true, code: codeFactice() }, 200, cors);
  }

  await verifierTurnstile(body.turnstileToken, request, env);

  const periode = await lirePeriode(env);
  const dateRetrait = dateIso(body.dateRetrait);
  if (dateRetrait < periode.dateDebut || dateRetrait > periode.dateFin) {
    throw httpError('La date de retrait est en dehors de la période proposée.', 400);
  }
  const heureRetrait = heureCreneau(body.heureRetrait, periode);

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
  const commentaire = texte(body.commentaire, { max: 300, champ: 'Le commentaire', multiligne: true });

  /* Le code de la commande existante ne repart plus dans la réponse : il
     suffisait de soumettre le numéro de quelqu'un pour apprendre qu'il avait
     commandé, et récupérer son code au passage. Le client légitime a le sien
     par e-mail ; celui qui ne l'a plus passe en boutique, où on l'identifie. */
  const doublon = await reservationEnCours(client.telephone, env);
  if (doublon) {
    return json({
      error: 'Une réservation est déjà en cours avec ce numéro de téléphone. '
           + 'Retrouvez son code dans votre e-mail de confirmation, ou passez en boutique.',
      duplicate: true
    }, 409, cors);
  }

  const { lignes, total } = await construireLignes(body.items, dateRetrait, env);
  const code = await genererCode(env);
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
    heureRetrait,
    commentaire,
    manageToken,
    annulableJusqua
  };

  await firestoreCreate('orders', { ...commande, createdAt: maintenant }, env);

  // Après l'écriture, et sans pouvoir la remettre en cause : une commande
  // enregistrée dont l'e-mail échoue reste une commande valable.
  const emailEnvoye = await envoyerConfirmation(commande, env);

  return json({ ok: true, code, total, dateRetrait, heureRetrait, emailEnvoye, email: client.email }, 200, cors);
}
