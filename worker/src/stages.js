// ============================================================
// POST /stage/reserve — inscription à un atelier
//
// Même principe que les commandes de Noël, et pour la même raison : le
// navigateur n'écrit pas dans `inscriptions`. Les règles le lui refusent,
// sans quoi la vérification anti-robot ne servirait à rien — elle ne peut
// pas vivre dans une règle Firestore, qui ne sait pas appeler Cloudflare.
//
//   1. piège à bots (champ caché) — accepté en apparence, jamais écrit
//   2. jeton Turnstile vérifié auprès de Cloudflare
//   3. inscriptions ouvertes ? séance visible, à venir, connue ?
//   4. participants et coordonnées validés, prix relu depuis la séance
//   5. places réservées ATOMIQUEMENT, rendues si la séance est pleine
//   6. code d'inscription, écriture, confirmation par e-mail
//
// La différence avec une commande tient à la place : une bûche de plus se
// fabrique, une place d'atelier non. Le décompte doit donc être juste même
// quand deux parents valident à la même seconde — d'où l'incrément côté
// serveur plutôt qu'un « lire, comparer, écrire » qui laisse passer les
// deux.
// ============================================================

import { json, httpError } from './http.js';
import {
  firestoreGet, firestoreCreate, firestoreIncrement, firestoreSet,
  firestoreUpdate, fromFirestoreFields
} from './firebase.js';
import { envoyerConfirmationStage } from './mailer.js';

const MAX_PARTICIPANTS = 6;    // par inscription, pas par séance
const AGE_MIN = 3;
const AGE_MAX = 99;

const PREFIXE_CODE   = 'STAGE';
const COMPTEUR_PATH  = 'compteurs/stages';
const COMPTEUR_CHAMP = 'dernier';

/* ---------- Numérotation ---------- */
/* Un compteur distinct de celui des commandes : les deux séries se lisent
   à voix haute au comptoir, et « STAGE0007 » ne doit pas répondre au même
   numéro que « SITE0007 ». */
async function prochainNumero(env) {
  try {
    return await firestoreIncrement(COMPTEUR_PATH, COMPTEUR_CHAMP, env);
  } catch {
    // Le transform seul exige un document existant : la première
    // inscription le crée, les suivantes retombent sur l'incrément.
    await firestoreSet(COMPTEUR_PATH, { [COMPTEUR_CHAMP]: 1 }, env);
    return 1;
  }
}

async function genererCode(env) {
  const numero = await prochainNumero(env);
  return `${PREFIXE_CODE}${String(numero).padStart(4, '0')}`;
}

/* Réponse du piège à bots : un code plausible, sans toucher au compteur
   réel — aucune inscription n'est créée, ce numéro n'existe nulle part. */
function codeFactice() {
  return `${PREFIXE_CODE}${String(Math.floor(1000 + Math.random() * 9000))}`;
}

/* ---------- Validation des champs libres ---------- */
/* Repris de `orders.js`, et pour la même raison : un caractère de contrôle
   dans un prénom traverse jusqu'à l'objet d'un e-mail. */
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

function email(v) {
  const s = String(v ?? '').trim();
  if (!s) throw httpError("Merci d'indiquer une adresse e-mail.", 400);
  if (s.length > 120 || contientControle(s, false) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    throw httpError('Adresse e-mail invalide.', 400);
  }
  return s;
}

/* L'âge sert à placer l'enfant au bon atelier, pas à faire un fichier :
   un entier, rien de plus. Il reste facultatif — un adulte n'a pas à le
   donner pour venir apprendre à tourner une baguette. */
function ageParticipant(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < AGE_MIN || n > AGE_MAX) {
    throw httpError(`Âge invalide (${AGE_MIN} à ${AGE_MAX} ans), ou laissez la case vide.`, 400);
  }
  return n;
}

function construireParticipants(liste, seance) {
  if (!Array.isArray(liste) || liste.length === 0) {
    throw httpError('Indiquez au moins un participant.', 400);
  }
  if (liste.length > MAX_PARTICIPANTS) {
    throw httpError(`Trop de participants pour une seule inscription (${MAX_PARTICIPANTS} maximum). Faites-en une seconde, ou appelez-nous.`, 400);
  }

  return liste.map(p => {
    const prenom = texte(p?.prenom, { min: 2, max: 40, champ: 'Le prénom du participant' });
    const nom    = texte(p?.nom ?? '', { max: 40, champ: 'Le nom du participant' });
    const age    = ageParticipant(p?.age);

    /* Les bornes d'âge de la séance sont indicatives à l'inscription, mais
       elles sont annoncées sur la page : les faire respecter ici évite
       qu'un enfant de six ans se retrouve inscrit à un atelier de tourage
       prévu pour des adultes, et qu'on doive le renvoyer sur le pas de la
       porte. Sans âge saisi, on laisse passer — la boulangerie verra bien. */
    if (age !== null) {
      if (Number.isInteger(seance.ageMin) && age < seance.ageMin) {
        throw httpError(`Cette séance est prévue à partir de ${seance.ageMin} ans.`, 409);
      }
      if (Number.isInteger(seance.ageMax) && age > seance.ageMax) {
        throw httpError(`Cette séance est prévue jusqu'à ${seance.ageMax} ans.`, 409);
      }
    }

    return { prenom, nom, age };
  });
}

/* ---------- Turnstile ---------- */
/* Identique à celle des commandes. Volontairement recopiée plutôt que
   partagée : les deux routes n'ont pas à évoluer ensemble, et une fonction
   commune inviterait à ajouter un paramètre « et là on ne vérifie pas ». */
async function verifierTurnstile(token, request, env) {
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

/* ---------- Séance ---------- */

function jourDuJour() {
  // Fuseau de Paris : le Worker tourne en UTC, et une séance du matin
  // resterait « à venir » jusqu'à 1 h du matin le lendemain sans cela.
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
}

async function lireSeance(id, env) {
  const identifiant = String(id ?? '').trim();
  /* Un identifiant Firestore, pas un chemin : sans ce contrôle, la valeur
     vient du corps d'une requête publique et se promène dans une URL.
     `cheminSur()` refuse déjà les points, celui-ci refuse en plus les
     barres obliques, qui désigneraient une autre collection. */
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(identifiant)) {
    throw httpError('Séance introuvable.', 404);
  }

  const doc = await firestoreGet(`stages/${identifiant}`, env).catch(() => null);
  if (!doc) throw httpError("Cette séance n'existe plus.", 404);

  const s = fromFirestoreFields(doc.fields);
  if (s.visible === false) throw httpError("Cette séance n'est plus proposée.", 409);
  if (!s.date || s.date < jourDuJour()) {
    throw httpError('Cette séance est déjà passée.', 409);
  }

  return { id: identifiant, ...s };
}

async function lireReglages(env) {
  const doc = await firestoreGet('settings/stages', env).catch(() => null);
  const s = doc ? fromFirestoreFields(doc.fields) : {};
  if (s.ouvert !== true) {
    throw httpError("Les inscriptions aux ateliers ne sont pas ouvertes pour le moment.", 409);
  }
  return s;
}

/* ---------- Réservation des places ---------- */
/* Le cœur de la route. Réserver puis vérifier, et non l'inverse : un
   « je lis les places restantes, je compare, j'écris » laisse deux
   inscriptions simultanées passer toutes les deux sur la dernière place.
   L'incrément est atomique côté Firestore, donc l'une des deux verra
   forcément le compteur dépasser — et rendra ce qu'elle a pris.

   Le compteur fait foi pour le décompte affiché ; le panel le recalcule à
   partir des inscriptions réelles dès qu'une place est libérée à la main. */
async function reserverPlaces(seance, nb, env) {
  const places = Number(seance.places);
  if (!Number.isInteger(places) || places <= 0) {
    throw httpError("Cette séance n'a pas de place ouverte à la réservation.", 409);
  }

  let prises;
  try {
    prises = await firestoreIncrement(`stages/${seance.id}`, 'placesPrises', env, nb);
  } catch {
    /* Le champ n'existe pas encore sur une séance qui n'a jamais reçu
       d'inscription : Firestore refuse le transform. On le pose à la
       valeur demandée, ce qui revient au même pour la première.

       Mais on revérifie d'abord que le compteur est bien absent : cet
       échec peut aussi être une panne passagère, et écraser un compteur
       existant par `nb` rendrait à la vente des places déjà prises. Une
       inscription refusée se refait ; une séance vendue deux fois se
       règle au comptoir, devant les gens. */
    const doc = await firestoreGet(`stages/${seance.id}`, env).catch(() => null);
    const actuel = doc ? fromFirestoreFields(doc.fields).placesPrises : undefined;
    if (actuel !== undefined && actuel !== null) {
      throw httpError("La réservation n'a pas pu être enregistrée. Réessayez dans un instant.", 503);
    }

    // `firestoreUpdate` et non `firestoreSet` : le second réécrit le
    // document entier, et la séance perdrait son nom, sa date et son prix.
    await firestoreUpdate(`stages/${seance.id}`, { placesPrises: nb }, env);
    prises = nb;
  }

  if (prises > places) {
    // On rend ce qu'on vient de prendre : sinon la séance resterait
    // marquée pleine à cause d'une inscription qui n'a jamais existé.
    await firestoreIncrement(`stages/${seance.id}`, 'placesPrises', env, -nb).catch(() => {});
    const restant = Math.max(0, places - (prises - nb));
    throw httpError(
      restant > 0
        ? `Il ne reste que ${restant} place${restant > 1 ? 's' : ''} sur cette séance.`
        : 'Cette séance est complète.',
      409
    );
  }

  return prises;
}

/* ---------- Route ---------- */

export async function handleStageReserve(request, env, cors) {
  const body = await request.json().catch(() => {
    throw httpError('Requête illisible.', 400);
  });

  // Piège à bots : un humain ne voit pas ce champ, donc ne le remplit pas.
  if (String(body.website ?? '').trim() !== '') {
    return json({ ok: true, code: codeFactice() }, 200, cors);
  }

  await verifierTurnstile(body.turnstileToken, request, env);
  await lireReglages(env);

  const seance = await lireSeance(body.stageId, env);
  const participants = construireParticipants(body.participants, seance);

  const prenom = texte(body.client?.prenom, { min: 2, max: 40, champ: 'Le prénom' });
  const nom    = texte(body.client?.nom,    { min: 2, max: 40, champ: 'Le nom' });
  const client = {
    prenom,
    nom,
    nomComplet: `${prenom} ${nom}`,
    telephone: telephoneFr(body.client?.telephone),
    email:     email(body.client?.email)
  };
  const commentaire = texte(body.commentaire, { max: 300, champ: 'Le commentaire', multiligne: true });

  // Le prix vient de la séance, jamais de la requête : sinon il suffirait
  // de modifier l'appel pour inscrire trois enfants à un euro.
  const prixUnitaire = Number(seance.prix) || 0;
  const total = Math.round(prixUnitaire * participants.length * 100) / 100;

  await reserverPlaces(seance, participants.length, env);

  const code = await genererCode(env);
  const maintenant = new Date();

  /* Comme pour les commandes : un jeton qui n'authentifie rien auprès de
     Firestore, mais qui permettra de retrouver l'inscription depuis un
     lien si on ouvre un jour la gestion en ligne. 122 bits, hors de portée
     d'une énumération. */
  const manageToken = crypto.randomUUID();

  const inscription = {
    code,
    statut: 'en_attente',
    stageId: seance.id,
    // Le nom, la date et le prix sont recopiés : la séance sera modifiée
    // ou supprimée, l'inscription doit rester lisible telle qu'elle a été
    // prise — c'est ce que le client a sous les yeux dans son e-mail.
    stageNom: seance.nom || 'Atelier',
    date: seance.date,
    heureDebut: seance.heureDebut || '',
    heureFin: seance.heureFin || '',
    prixUnitaire,
    total,
    participants,
    nbParticipants: participants.length,
    client,
    commentaire,
    manageToken
  };

  await firestoreCreate('inscriptions', { ...inscription, createdAt: maintenant }, env);

  // Après l'écriture, et sans pouvoir la remettre en cause : une
  // inscription enregistrée dont l'e-mail échoue reste une inscription.
  const emailEnvoye = await envoyerConfirmationStage(inscription, env);

  return json({
    ok: true,
    code,
    total,
    stageNom: inscription.stageNom,
    date: inscription.date,
    heureDebut: inscription.heureDebut,
    heureFin: inscription.heureFin,
    nbParticipants: participants.length,
    emailEnvoye,
    email: client.email
  }, 200, cors);
}
