// ============================================================
// POST /image        — envoyer une photo depuis le panel
// GET  /image/<clé>  — la servir
//
// Les photos passaient par Cloudinary, en « unsigned upload » : les deux
// valeurs nécessaires (nom du cloud et preset) vivent forcément dans le
// JavaScript du panel, donc dans un fichier public. N'importe qui les
// recopiait et téléversait dans le compte, sans être connecté à quoi que ce
// soit. Un endpoint d'écriture ouvert à tout Internet, pour un service dont
// le site n'utilisait aucune transformation : les URL étaient stockées et
// servies telles quelles.
//
// Ici l'envoi exige ce que le reste du panel exige — membre, double
// authentification franchie — puisqu'il passe par le même contrôle. Le
// fichier atterrit dans R2, et c'est ce Worker qui le sert : pas de bucket
// public à border, et les clés sont des UUID, donc rien à énumérer.
// ============================================================

import { json, httpError } from './http.js';
import { membreOuRefus } from './membre.js';
import { firestoreIncrement, firestoreSet } from './firebase.js';

const TAILLE_MAX = 8 * 1024 * 1024;   // doit rester aligné sur js/admin/uploader.js

/* Plafond d'envois par membre et par jour. La route exige déjà un membre
   authentifié et passé par la double authentification, donc il ne s'agit
   pas de se défendre d'Internet : il s'agit de borner ce qu'un compte
   égaré — ou une boucle dans le panel — peut déverser dans R2, où rien
   n'expire tout seul. Cinquante photos par jour ne gênent aucun usage
   normal : une refonte complète des visuels du site en compte moins. */
const ENVOIS_MAX_PAR_JOUR = 50;

/* Liste blanche plutôt que liste noire : un format non prévu est refusé,
   pas toléré. Le SVG en est absent volontairement — c'est du XML, il porte
   du script, et un navigateur l'exécute quand il l'affiche en pleine page. */
const FORMATS = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
};

/* Les dossiers viennent du panel (`produits`, `blocks`, `images`…). Bornés
   à un alphabet strict : ils composent une clé d'objet, et une valeur
   d'appelant n'a rien à faire telle quelle dans un chemin. */
function dossierSur(v) {
  const s = String(v ?? 'images').trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(s) ? s : 'images';
}

/* Un document par membre et par jour : le nom porte la date, donc rien à
   remettre à zéro et l'incrément reste atomique. `expireLe` le fait
   disparaître à la purge nocturne, deux jours plus tard — le délai évite
   qu'un compteur du jour soit effacé par une purge qui tourne à 3 h du
   matin dans un autre fuseau que celui du poste. */
async function compterEnvoi(uid, env) {
  const jour = new Date().toISOString().slice(0, 10);
  const chemin = `imageQuota/${uid}_${jour}`;

  let envois;
  try {
    envois = await firestoreIncrement(chemin, 'envois', env);
  } catch {
    // Un `transform` seul n'ouvre pas un document absent.
    await firestoreSet(chemin, {
      envois: 1,
      expireLe: new Date(Date.now() + 2 * 86400000)
    }, env);
    envois = 1;
  }

  if (envois > ENVOIS_MAX_PAR_JOUR) {
    throw httpError('Trop de photos envoyées aujourd’hui. Reprenez demain.', 429);
  }
}

export async function handleImageUpload(request, env, cors) {
  const entete = request.headers.get('Authorization') || '';
  const idToken = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  if (!idToken) throw httpError('Jeton manquant', 401);

  // Le comptoir consulte, il ne publie pas de photo sur le site.
  const membre = await membreOuRefus(idToken, env);
  if (membre.role === 'comptoir') {
    throw httpError("Ce rôle ne peut pas importer de photo.", 403);
  }

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  const extension = FORMATS[type];
  if (!extension) {
    throw httpError('Format non accepté. Utilisez un JPG, PNG, WebP ou AVIF.', 415);
  }

  /* `Content-Length` est déclaré par l'appelant, donc il ne fait pas foi —
     la taille réelle est revérifiée après lecture. Mais il est exigé, et
     c'est ce qui compte ici : sans lui, `arrayBuffer()` chargeait en mémoire
     tout ce qu'on lui envoyait avant que la moindre vérification n'ait lieu.
     Un membre authentifié pouvait faire tomber le Worker en poussant un
     corps de plusieurs centaines de Mo. Un navigateur envoyant un fichier
     renseigne toujours cet en-tête. */
  const annonce = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(annonce) || annonce <= 0) {
    throw httpError('Taille du fichier non déclarée.', 411);
  }
  if (annonce > TAILLE_MAX) throw httpError('Photo trop lourde — 8 Mo maximum.', 413);

  /* Compté une fois la requête reconnue valable, et avant de lire le corps :
     un format refusé n'entame pas le quota de la journée, un envoi accepté
     l'entame même si l'écriture dans R2 échoue ensuite. */
  await compterEnvoi(membre.uid, env);

  const octets = await request.arrayBuffer();
  if (octets.byteLength === 0) throw httpError('Fichier vide.', 400);
  if (octets.byteLength > TAILLE_MAX) throw httpError('Photo trop lourde — 8 Mo maximum.', 413);

  const cle = `${dossierSur(request.headers.get('X-Dossier'))}/${crypto.randomUUID()}.${extension}`;

  await env.IMAGES.put(cle, octets, {
    httpMetadata: {
      contentType: type,
      // Le nom porte un UUID : ce fichier-ci ne changera jamais de contenu,
      // le cache peut donc le garder indéfiniment.
      cacheControl: 'public, max-age=31536000, immutable'
    },
    customMetadata: { parUid: membre.uid, leJour: new Date().toISOString() }
  });

  const base = (env.SITE_IMAGES_URL || '').replace(/\/+$/, '') || new URL(request.url).origin;
  return json({ ok: true, url: `${base}/image/${cle}` }, 200, cors);
}

/* Servi par le Worker plutôt que par un bucket public : rien à exposer, et
   la réponse porte le cache long qui évite d'y revenir. */
export async function handleImageGet(request, env) {
  const cle = decodeURIComponent(new URL(request.url).pathname.slice('/image/'.length));
  if (!cle) return new Response('Not found', { status: 404 });

  const objet = await env.IMAGES.get(cle);
  if (!objet) return new Response('Not found', { status: 404 });

  const entetes = new Headers();
  objet.writeHttpMetadata(entetes);
  entetes.set('etag', objet.httpEtag);
  entetes.set('Cache-Control', 'public, max-age=31536000, immutable');
  // Le contenu vient d'un envoi : on interdit au navigateur de deviner un
  // type autre que celui qu'on annonce.
  entetes.set('X-Content-Type-Options', 'nosniff');

  return new Response(objet.body, { headers: entetes });
}
