// ============================================================
// UPLOADER — import de photos vers le Worker + popup de progression
// ============================================================

import { SVG_X } from "./icons.js";
import { WORKER_URL } from "./config.js";
import { auth } from "../firebase-config.js";

/* Les photos partaient chez Cloudinary en envoi non signé. Les deux valeurs
   que cela demandait — nom du cloud et preset — vivent forcément dans ce
   fichier, téléchargé par tous les visiteurs : l'endroit où l'on déposait
   les photos du site était donc ouvert à tout Internet, sans compte.
   Elles passent maintenant par le Worker, qui exige un membre authentifié
   et les range dans R2. Aucune valeur à cacher ici, et plus rien à border
   dans une console tierce. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // doit rester aligné sur worker/src/images.js
const RING_LENGTH = 339.292;              // 2πr avec r=54, cf. .upload-ring-fill

/* ---------- Popup de progression ---------- */
const uploadUI = {
  overlay:  document.getElementById('uploadOverlay'),
  modal:    document.querySelector('.upload-modal'),
  thumb:    document.getElementById('uploadThumb'),
  ring:     document.getElementById('uploadRing'),
  percent:  document.getElementById('uploadPercent'),
  check:    document.getElementById('uploadCheck'),
  cross:    document.getElementById('uploadCross'),
  title:    document.getElementById('uploadTitle'),
  sub:      document.getElementById('uploadSub'),
  actions:  document.getElementById('uploadActions'),
  closeBtn: document.getElementById('uploadCloseBtn')
};

function setUploadProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  uploadUI.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - clamped / 100));
  uploadUI.percent.firstChild.nodeValue = String(clamped);
}

let uploadCloseTimer = null;

function openUploadModal(file, rang = 1, total = 1) {
  clearTimeout(uploadCloseTimer); // un import relancé ne doit pas hériter du timer précédent
  uploadUI.modal.classList.remove('is-error');
  uploadUI.check.hidden = true;
  uploadUI.cross.hidden = true;
  uploadUI.percent.hidden = false;
  uploadUI.actions.hidden = true;
  // Un dépôt groupé peut porter dix photos : sans le rang, la fenêtre semble
  // repartir de zéro sans raison à chaque fichier.
  uploadUI.title.textContent = total > 1
    ? `Import de la photo ${rang} sur ${total}`
    : 'Import de la photo';
  uploadUI.sub.textContent = file.name;
  uploadUI.ring.style.strokeDashoffset = String(RING_LENGTH);
  setUploadProgress(0);

  // Aperçu local immédiat, sans attendre la fin de l'envoi
  if (uploadUI.thumb.dataset.blob) URL.revokeObjectURL(uploadUI.thumb.dataset.blob);
  const blobUrl = URL.createObjectURL(file);
  uploadUI.thumb.dataset.blob = blobUrl;
  uploadUI.thumb.src = blobUrl;

  uploadUI.overlay.hidden = false;
}

function finishUploadModal({ ok, title, sub }) {
  uploadUI.percent.hidden = true;
  uploadUI.modal.classList.toggle('is-error', !ok);
  uploadUI.check.hidden = !ok;
  uploadUI.cross.hidden = ok;
  if (ok) setUploadProgress(100);
  uploadUI.title.textContent = title;
  uploadUI.sub.textContent = sub;

  if (ok) {
    uploadCloseTimer = setTimeout(closeUploadModal, 900); // succès : se referme tout seul
  } else {
    uploadUI.actions.hidden = false;   // erreur : l'utilisateur doit la lire
    uploadUI.closeBtn.focus();
  }
}

function closeUploadModal() {
  clearTimeout(uploadCloseTimer);
  uploadUI.overlay.hidden = true;
  if (uploadUI.thumb.dataset.blob) {
    URL.revokeObjectURL(uploadUI.thumb.dataset.blob);
    delete uploadUI.thumb.dataset.blob;
  }
  uploadUI.thumb.removeAttribute('src');
}

uploadUI.closeBtn.addEventListener('click', closeUploadModal);

/* ---------- Envoi vers le Worker ---------- */

/* Même liste que `worker/src/images.js`. Le SVG en est absent des deux
   côtés : c'est du XML, il porte du script, et un navigateur l'exécute
   quand il l'affiche en pleine page. */
export const FORMATS_ACCEPTES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/* XMLHttpRequest plutôt que fetch : c'est le seul moyen d'avoir la
   progression d'un envoi, fetch ne l'expose pas.
   Le fichier part tel quel dans le corps, sans FormData — le serveur n'a
   besoin que des octets, et le type comme le dossier tiennent dans des
   en-têtes. */
async function uploadImageFile(file, folder) {
  if (!FORMATS_ACCEPTES.includes(file.type)) {
    throw new Error('Format non accepté. Utilise un JPG, PNG, WebP ou AVIF.');
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Photo trop lourde — 8 Mo maximum.');

  const user = auth.currentUser;
  if (!user) throw new Error('Session expirée. Reconnecte-toi.');
  const idToken = await user.getIdToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${WORKER_URL}/image`);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('X-Dossier', folder);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) setUploadProgress((e.loaded / e.total) * 100);
    });

    xhr.addEventListener('load', () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* réponse illisible */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body.url);
      else reject(new Error(body.error || `L'import a échoué (code ${xhr.status}).`));
    });

    xhr.addEventListener('error', () => reject(new Error("Connexion impossible au serveur d'images. Vérifie ta connexion internet.")));
    xhr.addEventListener('abort', () => reject(new Error("L'import a été annulé.")));

    xhr.send(file);
  });
}

function uploadErrorMessage(err) {
  return err.message || "L'import a échoué.";
}

/* ---------- Import d'un lot de photos ---------- */
/* Un par un, pas en parallèle : l'anneau de progression ne sait montrer
   qu'un envoi à la fois, et le Worker compte les envois de la journée —
   autant ne pas lui en jeter dix d'un coup.
   `surChaque` reçoit chaque URL au fil de l'eau : une photo importée reste
   acquise même si la suivante échoue. */
export async function importerPhotos(fichiers, dossier, surChaque) {
  const echecs = [];
  let reussies = 0;

  for (const [i, fichier] of fichiers.entries()) {
    openUploadModal(fichier, i + 1, fichiers.length);
    try {
      const url = await uploadImageFile(fichier, dossier);
      await surChaque(url, fichier);
      reussies++;
    } catch (err) {
      echecs.push(`${fichier.name} — ${uploadErrorMessage(err)}`);
    }
  }

  if (!echecs.length) {
    finishUploadModal({
      ok: true,
      title: reussies > 1 ? `${reussies} photos importées` : 'Photo importée',
      sub: reussies > 1 ? 'Elles sont prêtes à être enregistrées.' : 'Elle est prête à être enregistrée.'
    });
  } else {
    finishUploadModal({
      ok: false,
      title: reussies ? `${reussies} importée(s), ${echecs.length} en échec` : "L'import a échoué",
      // Les trois premiers échecs suffisent : au-delà, c'est la même cause.
      sub: echecs.slice(0, 3).join(' · ')
    });
  }

  return { reussies, echecs };
}

/* ---------- Glisser-déposer ---------- */
/* Un fichier lâché sur une page sans `preventDefault` remplace la page par
   l'image : les deux premiers écouteurs ne sont pas décoratifs. */
function porteDesFichiers(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}

/**
 * Accepte le dépôt de photos sur `zone`. Ignore tout ce qui n'est pas un
 * fichier — le réordonnancement des lignes, qui transporte du texte, passe
 * donc à travers sans être intercepté ici.
 */
export function brancherDepot(zone, traiter, classeActive = 'is-depot') {
  // `dragenter` et `dragleave` se déclenchent aussi en passant d'un enfant à
  // l'autre : sans ce compteur, le cadre clignote pendant le survol.
  let profondeur = 0;

  zone.addEventListener('dragenter', e => {
    if (!porteDesFichiers(e)) return;
    e.preventDefault();
    if (++profondeur === 1) zone.classList.add(classeActive);
  });

  zone.addEventListener('dragover', e => {
    if (!porteDesFichiers(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  zone.addEventListener('dragleave', e => {
    if (!porteDesFichiers(e)) return;
    if (--profondeur <= 0) { profondeur = 0; zone.classList.remove(classeActive); }
  });

  zone.addEventListener('drop', e => {
    if (!porteDesFichiers(e)) return;
    e.preventDefault();
    profondeur = 0;
    zone.classList.remove(classeActive);

    const fichiers = Array.from(e.dataTransfer.files);
    const photos = fichiers.filter(f => FORMATS_ACCEPTES.includes(f.type));
    if (photos.length) {
      traiter(photos);
    } else if (fichiers.length) {
      // Un PDF ou un HEIC déposé ne doit pas disparaître en silence.
      openUploadModal(fichiers[0]);
      finishUploadModal({
        ok: false,
        title: 'Format non accepté',
        sub: 'Utilise un JPG, PNG, WebP ou AVIF.'
      });
    }
  });
}

/**
 * Bloc "Importer une photo" qui remplace un ancien champ URL.
 * L'URL finale reste dans un <input type="hidden"> qui garde l'id/la classe
 * d'origine, pour que le code de collecte existant continue de marcher.
 */
export function createImageUploader({ id = '', className = '', value = '', folder = 'images', compact = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'image-upload' + (compact ? ' image-upload--compact' : '');

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  if (id) hidden.id = id;
  if (className) hidden.className = className;
  hidden.value = value || '';

  const preview = document.createElement('img');
  preview.className = 'image-upload-preview';
  preview.alt = '';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  // Meme liste que la verification, pour que le selecteur de fichiers ne
  // propose pas ce qui sera refuse ensuite.
  fileInput.accept = FORMATS_ACCEPTES.join(',');
  fileInput.hidden = true;

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'btn btn-ghost btn-small';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'row-remove';
  clearBtn.title = 'Retirer la photo';
  clearBtn.innerHTML = SVG_X;

  function refresh() {
    const url = hidden.value.trim();
    if (url) preview.src = url; else preview.removeAttribute('src');
    pickBtn.textContent = url ? 'Changer la photo' : 'Importer une photo';
    clearBtn.hidden = !url;
  }

  pickBtn.addEventListener('click', () => fileInput.click());

  clearBtn.addEventListener('click', () => {
    hidden.value = '';
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
  });

  async function importer(fichiers) {
    pickBtn.disabled = true;
    // Un seul emplacement ici : si plusieurs photos sont lâchées, c'est la
    // première qui compte. Le cas du lot appartient aux réalisations.
    await importerPhotos(fichiers.slice(0, 1), folder, url => {
      hidden.value = url;
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
    });
    pickBtn.disabled = false;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // permet de re-choisir le même fichier ensuite
    if (file) importer([file]);
  });

  // La photo se dépose aussi depuis le bureau, sur le bloc lui-même.
  brancherDepot(wrap, importer);

  // setVal() émet un 'input' : l'aperçu se met à jour au chargement des réglages
  hidden.addEventListener('input', refresh);

  wrap.append(preview, pickBtn, clearBtn, hidden, fileInput);
  refresh();
  return wrap;
}
