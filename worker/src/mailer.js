// ============================================================
// MAILER — confirmations de commande, via l'API Brevo
//
// Rien ici ne doit faire échouer une commande. Le client a déjà son code
// à l'écran et la réservation est écrite en base : si l'e-mail ne part
// pas, on le signale à l'appelant, on ne perd pas la commande.
// ============================================================

import { firestoreList } from './firebase.js';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const euros = n => Number(n || 0).toLocaleString('fr-FR', {
  style: 'currency', currency: 'EUR'
});

function jourLisible(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

/* Date limite d'annulation : jour ET heure, parce qu'elle tombe rarement à
   minuit. Forcée sur le fuseau de Paris — le Worker tourne en UTC, et une
   limite affichée avec une heure de retard se retourne contre nous. */
function momentLisible(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
  });
}

function lienGestion(commande, env) {
  if (!env.SITE_URL || !commande.manageToken) return '';
  return `${env.SITE_URL.replace(/\/+$/, '')}/ma-commande.html?t=${encodeURIComponent(commande.manageToken)}`;
}

/* Le nom du client et son commentaire finissent dans du HTML d'e-mail.
   Les clients de messagerie interprètent ce HTML : sans échappement, un
   nom contenant du balisage casserait la mise en page, au mieux. */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function lignesHtml(items) {
  return (items || []).map(it => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #f1e6d3;">
        <strong>${it.quantite}×</strong> ${esc(it.nom)}
      </td>
      <td style="padding:6px 0;border-bottom:1px solid #f1e6d3;text-align:right;white-space:nowrap;">
        ${esc(euros(it.prixUnitaire * it.quantite))}
      </td>
    </tr>`).join('');
}

function lignesTexte(items) {
  return (items || []).map(it =>
    `  ${it.quantite} x ${it.nom} — ${euros(it.prixUnitaire * it.quantite)}`
  ).join('\n');
}

function mailClient(commande, env) {
  const { code, client, items, total, dateRetrait } = commande;
  const jour = jourLisible(dateRetrait);

  /* Le bloc de gestion ne s'affiche que si les deux conditions sont
     réunies : une page où aller, et un délai encore ouvert. Annoncer un
     lien d'annulation là où le délai est nul serait pire que se taire. */
  const lien = lienGestion(commande, env);
  const limite = commande.annulableJusqua ? momentLisible(commande.annulableJusqua) : '';
  const gestionHtml = lien && limite ? `
  <div style="border:1px solid #e7c79a;border-radius:10px;padding:16px;margin:0 0 20px;">
    <p style="margin:0 0 8px;font-weight:bold;">Un empêchement ?</p>
    <p style="margin:0 0 12px;color:#4a423a;">
      Vous pouvez annuler cette réservation en ligne jusqu'au
      <strong>${esc(limite)}</strong>.
    </p>
    <a href="${esc(lien)}" style="display:inline-block;background:#c8853a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:bold;">
      Gérer ma réservation
    </a>
  </div>` : '';
  const gestionTexte = lien && limite ? `
Un empêchement ? Vous pouvez annuler cette réservation en ligne jusqu'au
${limite} :
${lien}
` : '';

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:20px;margin:0 0 4px;">Votre réservation est enregistrée</h1>
  <p style="color:#4a423a;margin:0 0 24px;">Bonjour ${esc(client.prenom || client.nom)},</p>

  <div style="background:#f1e6d3;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#4a423a;">
      Votre code de réservation
    </p>
    <p style="margin:0;font-size:32px;font-weight:bold;letter-spacing:.18em;color:#8c5a26;">
      ${esc(code)}
    </p>
  </div>

  <p style="margin:0 0 8px;"><strong>Retrait :</strong> ${esc(jour)}</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    ${lignesHtml(items)}
    <tr>
      <td style="padding:10px 0;font-weight:bold;">Total à régler en boutique</td>
      <td style="padding:10px 0;text-align:right;font-weight:bold;white-space:nowrap;">${esc(euros(total))}</td>
    </tr>
  </table>

  <p style="background:#fdf6e9;border-left:3px solid #c8853a;padding:12px 16px;margin:0 0 20px;">
    Votre réservation est acceptée <strong>sous réserve de votre passage en boutique</strong>.
    Présentez ce code pour la confirmer. Le règlement se fait sur place, au retrait —
    aucun paiement n'est demandé en ligne.
  </p>
${gestionHtml}
  <p style="color:#4a423a;font-size:14px;margin:0;">
    À très vite,<br>Au P'tit Paradis — Luc-sur-Mer
  </p>
</div>`;

  const texte = `Votre réservation est enregistrée

Bonjour ${client.prenom || client.nom},

Votre code de réservation : ${code}
Retrait : ${jour}

${lignesTexte(items)}

Total à régler en boutique : ${euros(total)}

Votre réservation est acceptée sous réserve de votre passage en boutique.
Présentez ce code pour la confirmer. Le règlement se fait sur place, au
retrait — aucun paiement n'est demandé en ligne.
${gestionTexte}
À très vite,
Au P'tit Paradis — Luc-sur-Mer`;

  return { sujet: `Votre réservation Au P'tit Paradis — code ${code}`, html, texte };
}

/* ---------- Annulation par le client ---------- */

function mailClientAnnulation(commande) {
  const { code, client, dateRetrait } = commande;

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:20px;margin:0 0 4px;">Votre réservation est annulée</h1>
  <p style="color:#4a423a;margin:0 0 20px;">Bonjour ${esc(client.prenom || client.nom)},</p>

  <p style="margin:0 0 16px;">
    La réservation <strong>${esc(code)}</strong>, prévue pour le
    ${esc(jourLisible(dateRetrait))}, a bien été annulée. Il n'y a rien
    d'autre à faire de votre côté, et rien à régler.
  </p>

  <p style="margin:0 0 20px;color:#4a423a;">
    C'était une erreur ? Repassez une réservation depuis le site tant que les
    commandes sont ouvertes, ou appelez-nous.
  </p>

  <p style="color:#4a423a;font-size:14px;margin:0;">
    À bientôt,<br>Au P'tit Paradis — Luc-sur-Mer
  </p>
</div>`;

  const texte = `Votre réservation est annulée

Bonjour ${client.prenom || client.nom},

La réservation ${code}, prévue pour le ${jourLisible(dateRetrait)}, a bien
été annulée. Il n'y a rien d'autre à faire de votre côté, et rien à régler.

C'était une erreur ? Repassez une réservation depuis le site tant que les
commandes sont ouvertes, ou appelez-nous.

À bientôt,
Au P'tit Paradis — Luc-sur-Mer`;

  return { sujet: `Réservation annulée — ${code}`, html, texte };
}

function mailPatronAnnulation(commande) {
  const { code, client, items, total, dateRetrait } = commande;
  const nom = client.nomComplet || `${client.prenom} ${client.nom}`;

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:18px;margin:0 0 16px;">Réservation annulée par le client — ${esc(code)}</h1>
  <p style="margin:0 0 4px;"><strong>${esc(nom)}</strong></p>
  <p style="margin:0 0 4px;">${esc(client.telephone)} · ${esc(client.email)}</p>
  <p style="margin:0 0 16px;"><strong>Retrait qui était prévu :</strong> ${esc(jourLisible(dateRetrait))}</p>
  <table style="width:100%;border-collapse:collapse;">
    ${lignesHtml(items)}
    <tr>
      <td style="padding:10px 0;font-weight:bold;">Total annulé</td>
      <td style="padding:10px 0;text-align:right;font-weight:bold;">${esc(euros(total))}</td>
    </tr>
  </table>
  <p style="color:#4a423a;font-size:13px;">La commande est déjà passée en « Annulée » dans le panel. Rien à faire.</p>
</div>`;

  const texte = `Réservation annulée par le client — ${code}

${nom}
${client.telephone} · ${client.email}
Retrait qui était prévu : ${jourLisible(dateRetrait)}

${lignesTexte(items)}

Total annulé : ${euros(total)}

La commande est déjà passée en « Annulée » dans le panel. Rien à faire.`;

  return { sujet: `Commande annulée — ${nom} — ${dateRetrait}`, html, texte };
}

function mailPatron(commande) {
  const { code, client, items, total, dateRetrait, commentaire } = commande;
  const nom = client.nomComplet || `${client.prenom} ${client.nom}`;

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:18px;margin:0 0 16px;">Nouvelle réservation — ${esc(code)}</h1>
  <p style="margin:0 0 4px;"><strong>${esc(nom)}</strong></p>
  <p style="margin:0 0 4px;">${esc(client.telephone)} · ${esc(client.email)}</p>
  <p style="margin:0 0 16px;"><strong>Retrait :</strong> ${esc(jourLisible(dateRetrait))}</p>
  <table style="width:100%;border-collapse:collapse;">
    ${lignesHtml(items)}
    <tr>
      <td style="padding:10px 0;font-weight:bold;">Total</td>
      <td style="padding:10px 0;text-align:right;font-weight:bold;">${esc(euros(total))}</td>
    </tr>
  </table>
  ${commentaire ? `<p style="background:#f1e6d3;padding:12px 16px;font-style:italic;">« ${esc(commentaire)} »</p>` : ''}
  <p style="color:#4a423a;font-size:13px;">À confirmer dans le panel quand le client passe en boutique.</p>
</div>`;

  const texte = `Nouvelle réservation — ${code}

${nom}
${client.telephone} · ${client.email}
Retrait : ${jourLisible(dateRetrait)}

${lignesTexte(items)}

Total : ${euros(total)}
${commentaire ? `\nCommentaire : « ${commentaire} »\n` : ''}
À confirmer dans le panel quand le client passe en boutique.`;

  return { sujet: `Nouvelle commande — ${nom} — ${dateRetrait}`, html, texte };
}

async function envoyer({ destinataire, nomDestinataire, sujet, html, texte }, env) {
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: {
        email: env.EMAIL_EXPEDITEUR,
        name: env.EMAIL_EXPEDITEUR_NOM || "Au P'tit Paradis"
      },
      to: [{ email: destinataire, name: nomDestinataire || undefined }],
      subject: sujet,
      htmlContent: html,
      textContent: texte
    })
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

/* Qui reçoit les alertes de commande : chaque membre du panel décide pour
   lui-même depuis l'onglet Équipe. L'absence du champ vaut refus — on
   n'inscrit personne à son insu. */
async function destinatairesAlerte(env) {
  try {
    const membres = await firestoreList('admins', env);
    return membres.filter(m => m.notifications === true && m.email).map(m => m.email);
  } catch (err) {
    console.error('Liste des destinataires illisible :', err.message);
    return [];
  }
}

/**
 * Envoie la confirmation au client, puis une alerte à chaque membre du
 * panel qui l'a demandée. Ne lève jamais : renvoie `true` si le client a
 * bien été prévenu, `false` sinon.
 */
export async function envoyerConfirmation(commande, env) {
  // Service non configuré : la commande reste valable, le client a son
  // code à l'écran. On ne prétend simplement pas lui avoir écrit.
  if (!env.BREVO_API_KEY || !env.EMAIL_EXPEDITEUR) return false;

  return diffuser(commande, mailClient(commande, env), mailPatron(commande), env);
}

/**
 * Prévient le client que sa réservation est annulée, et les membres du
 * panel abonnés aux alertes. Mêmes garanties que ci-dessus : ne lève
 * jamais, l'annulation est déjà enregistrée.
 */
export async function envoyerAnnulation(commande, env) {
  if (!env.BREVO_API_KEY || !env.EMAIL_EXPEDITEUR) return false;
  return diffuser(commande, mailClientAnnulation(commande), mailPatronAnnulation(commande), env);
}

/* Un e-mail au client, un à chaque membre abonné. L'échec de l'un
   n'empêche pas les autres : la boulangerie doit être prévenue même si
   l'adresse du client rebondit. */
async function diffuser(commande, pourClient, pourPatron, env) {
  let clientPrevenu = false;
  try {
    await envoyer({
      destinataire: commande.client.email,
      nomDestinataire: commande.client.nomComplet,
      ...pourClient
    }, env);
    clientPrevenu = true;
  } catch (err) {
    console.error('E-mail client non envoyé :', err.message);
  }

  for (const destinataire of await destinatairesAlerte(env)) {
    try {
      await envoyer({ destinataire, ...pourPatron }, env);
    } catch (err) {
      console.error(`Alerte non envoyée à ${destinataire} :`, err.message);
    }
  }

  return clientPrevenu;
}
