// ============================================================
// UPLOADER — import de photos vers Cloudinary + popup de progression
// ============================================================

import { SVG_X } from "./icons.js";

/* Cloudinary — hébergement des photos.
   Ces deux valeurs sont publiques par nature : le cloud name apparaît dans
   chaque URL d'image, et le preset est "unsigned" (envoi sans signature).
   Aucun secret ici — l'API Secret du compte ne doit jamais arriver dans ce
   fichier, qui est téléchargé par tous les visiteurs du site. */
const CLOUDINARY_CLOUD_NAME = 'erbyexpc';
const CLOUDINARY_PRESET     = 'auptitparadis';
const CLOUDINARY_ENDPOINT   = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // doit rester aligné sur le preset Cloudinary
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

function openUploadModal(file) {
  clearTimeout(uploadCloseTimer); // un import relancé ne doit pas hériter du timer précédent
  uploadUI.modal.classList.remove('is-error');
  uploadUI.check.hidden = true;
  uploadUI.cross.hidden = true;
  uploadUI.percent.hidden = false;
  uploadUI.actions.hidden = true;
  uploadUI.title.textContent = 'Import de la photo';
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

/* ---------- Envoi vers Cloudinary ---------- */
/* XMLHttpRequest plutôt que fetch : c'est le seul moyen d'avoir la
   progression d'un envoi, fetch ne l'expose pas. */
function uploadImageFile(file, folder) {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error("Ce fichier n'est pas une image."));
  if (file.size > MAX_UPLOAD_BYTES) return Promise.reject(new Error('Photo trop lourde — 8 Mo maximum.'));

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', CLOUDINARY_PRESET);
  form.append('folder', `auptitparadis/${folder}`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', CLOUDINARY_ENDPOINT);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) setUploadProgress((e.loaded / e.total) * 100);
    });

    xhr.addEventListener('load', () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* réponse illisible */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.secure_url) resolve(body.secure_url);
      else reject(new Error(cloudinaryError(xhr.status, body)));
    });

    xhr.addEventListener('error', () => reject(new Error('Connexion impossible à Cloudinary. Vérifie ta connexion internet.')));
    xhr.addEventListener('abort', () => reject(new Error("L'import a été annulé.")));

    xhr.send(form);
  });
}

function cloudinaryError(statusCode, body) {
  const raw = body && body.error && body.error.message ? body.error.message : '';
  if (/upload preset not found/i.test(raw)) {
    return `Le preset « ${CLOUDINARY_PRESET} » est introuvable. Vérifie son nom exact dans Cloudinary (Settings > Upload).`;
  }
  if (/unsigned|whitelist/i.test(raw)) {
    return `Le preset « ${CLOUDINARY_PRESET} » n'est pas en mode Unsigned, ou les envois non signés sont bloqués (Settings > Security).`;
  }
  if (/file size|too large/i.test(raw)) return 'Photo refusée par Cloudinary : fichier trop lourd.';
  if (/format/i.test(raw)) return 'Format refusé par Cloudinary. Utilise un JPG, PNG ou WebP.';
  return raw || `Cloudinary a renvoyé une erreur (code ${statusCode}).`;
}

function uploadErrorMessage(err) {
  return err.message || "L'import a échoué.";
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
  fileInput.accept = 'image/*';
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

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // permet de re-choisir le même fichier ensuite
    if (!file) return;
    pickBtn.disabled = true;
    openUploadModal(file);
    try {
      hidden.value = await uploadImageFile(file, folder);
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      finishUploadModal({ ok: true, title: 'Photo importée', sub: 'Elle est prête à être enregistrée.' });
    } catch (err) {
      finishUploadModal({ ok: false, title: "L'import a échoué", sub: uploadErrorMessage(err) });
    }
    pickBtn.disabled = false;
  });

  // setVal() émet un 'input' : l'aperçu se met à jour au chargement des réglages
  hidden.addEventListener('input', refresh);

  wrap.append(preview, pickBtn, clearBtn, hidden, fileInput);
  refresh();
  return wrap;
}
