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

/* Le retrait tel qu'on l'annonce au client : le jour seul tant qu'aucun
   créneau horaire n'est proposé, sinon le jour et l'heure. Les commandes
   passées avant les créneaux n'ont pas d'heure et gardent leur affichage. */
function retraitLisible(commande) {
  const jour = jourLisible(commande.dateRetrait);
  if (!jour || !commande.heureRetrait) return jour;
  return `${jour} à ${String(commande.heureRetrait).replace(':', 'h')}`;
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
  const { code, client, items, total } = commande;
  const jour = retraitLisible(commande);

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

function mailClientAnnulation(commande, env) {
  const { code, client, items, total } = commande;
  const retrait = retraitLisible(commande);
  const lienCommander = env.SITE_URL
    ? `${env.SITE_URL.replace(/\/+$/, '')}/commander.html`
    : '';

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:20px;margin:0 0 4px;">Votre réservation est annulée</h1>
  <p style="color:#4a423a;margin:0 0 24px;">Bonjour ${esc(client.prenom || client.nom)},</p>

  <!-- Même encadré que la confirmation, en gris : le client reconnaît le
       bloc où figurait son code, et voit du premier coup d'œil qu'il ne
       vaut plus rien. -->
  <div style="background:#ece7de;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6156;">
      Réservation annulée
    </p>
    <p style="margin:0;font-size:32px;font-weight:bold;letter-spacing:.18em;color:#8a8177;text-decoration:line-through;">
      ${esc(code)}
    </p>
  </div>

  <p style="margin:0 0 8px;color:#4a423a;">
    <strong>Retrait qui était prévu :</strong> ${esc(retrait)}
  </p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;color:#6b6156;">
    ${lignesHtml(items)}
    <tr>
      <td style="padding:10px 0;font-weight:bold;">Montant qui était à régler</td>
      <td style="padding:10px 0;text-align:right;font-weight:bold;white-space:nowrap;">${esc(euros(total))}</td>
    </tr>
  </table>

  <p style="background:#eef4ee;border-left:3px solid #4a8a5f;padding:12px 16px;margin:0 0 24px;">
    <strong>Vous n'avez rien à faire.</strong> Rien n'est dû, aucun paiement
    n'a été pris en ligne, et vous n'avez pas à vous déplacer.
  </p>

  ${lienCommander ? `
  <p style="margin:0 0 12px;color:#4a423a;">C'était une erreur, ou vous changez d'avis ?</p>
  <p style="margin:0 0 24px;">
    <a href="${esc(lienCommander)}" style="display:inline-block;background:#c8853a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;">
      Passer une nouvelle réservation
    </a>
  </p>` : `
  <p style="margin:0 0 24px;color:#4a423a;">
    C'était une erreur ? Repassez une réservation depuis le site tant que les
    commandes sont ouvertes, ou appelez-nous.
  </p>`}

  <p style="color:#4a423a;font-size:14px;margin:0;">
    À bientôt,<br>Au P'tit Paradis — Luc-sur-Mer
  </p>
</div>`;

  const texte = `Votre réservation est annulée

Bonjour ${client.prenom || client.nom},

RÉSERVATION ANNULÉE — code ${code}
Retrait qui était prévu : ${retrait}

${lignesTexte(items)}

Montant qui était à régler : ${euros(total)}

Vous n'avez rien à faire. Rien n'est dû, aucun paiement n'a été pris en
ligne, et vous n'avez pas à vous déplacer.

C'était une erreur, ou vous changez d'avis ?
${lienCommander ? lienCommander : 'Repassez une réservation depuis le site, ou appelez-nous.'}

À bientôt,
Au P'tit Paradis — Luc-sur-Mer`;

  return { sujet: `Réservation annulée — ${code}`, html, texte };
}

function mailPatronAnnulation(commande) {
  const { code, client, items, total, dateRetrait } = commande;
  const nom = client.nomComplet || `${client.prenom} ${client.nom}`;
  const retrait = retraitLisible(commande);

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:18px;margin:0 0 16px;">Réservation annulée par le client — ${esc(code)}</h1>
  <p style="margin:0 0 4px;"><strong>${esc(nom)}</strong></p>
  <p style="margin:0 0 4px;">${esc(client.telephone)} · ${esc(client.email)}</p>
  <p style="margin:0 0 16px;"><strong>Retrait qui était prévu :</strong> ${esc(retrait)}</p>
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
Retrait qui était prévu : ${retrait}

${lignesTexte(items)}

Total annulé : ${euros(total)}

La commande est déjà passée en « Annulée » dans le panel. Rien à faire.`;

  return { sujet: `Commande annulée — ${nom} — ${dateRetrait}`, html, texte };
}

function mailPatron(commande) {
  const { code, client, items, total, dateRetrait, commentaire } = commande;
  const nom = client.nomComplet || `${client.prenom} ${client.nom}`;
  const retrait = retraitLisible(commande);

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:18px;margin:0 0 16px;">Nouvelle réservation — ${esc(code)}</h1>
  <p style="margin:0 0 4px;"><strong>${esc(nom)}</strong></p>
  <p style="margin:0 0 4px;">${esc(client.telephone)} · ${esc(client.email)}</p>
  <p style="margin:0 0 16px;"><strong>Retrait :</strong> ${esc(retrait)}</p>
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
Retrait : ${retrait}

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
  // Journalisé même en cas de succès : sans ça, un e-mail qui n'arrive pas
  // laisse le doute entre « jamais parti » et « parti puis filtré ».
  // L'adresse n'est pas écrite en clair dans les journaux.
  const corps = await res.text();
  console.log(`[brevo] ${res.status} vers @${String(destinataire).split('@')[1] || '?'} — ${corps.slice(0, 200)}`);
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${corps}`);
}

/* ---------- Code de connexion au panel ---------- */

/**
 * Envoie le code à six chiffres. Renvoie `true` si Brevo l'a accepté :
 * contrairement aux e-mails de commande, celui-ci est bloquant — sans lui
 * personne n'entre, et prétendre l'avoir envoyé laisserait quelqu'un
 * attendre un message qui n'arrive pas.
 */
export async function envoyerCodeA2F({ email, prenom, code }, env) {
  if (!env.BREVO_API_KEY || !env.EMAIL_EXPEDITEUR) return false;

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:460px;margin:0 auto;">
  <h1 style="font-size:19px;margin:0 0 4px;">Connexion à l'administration</h1>
  <p style="color:#4a423a;margin:0 0 22px;">${prenom ? `Bonjour ${esc(prenom)},` : 'Bonjour,'}</p>

  <div style="background:#f1e6d3;border-radius:10px;padding:20px;text-align:center;margin-bottom:22px;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#4a423a;">
      Votre code de connexion
    </p>
    <p style="margin:0;font-size:34px;font-weight:bold;letter-spacing:.3em;color:#8c5a26;">
      ${esc(code)}
    </p>
    <p style="margin:10px 0 0;font-size:13px;color:#4a423a;">Valable 10 minutes.</p>
  </div>

  <p style="background:#fbeae6;border-left:3px solid #c0563f;padding:12px 16px;margin:0 0 20px;font-size:14px;">
    <strong>Vous n'essayez pas de vous connecter ?</strong> Quelqu'un connaît votre
    mot de passe. Ne communiquez ce code à personne et changez votre mot de passe.
  </p>

  <p style="color:#4a423a;font-size:13px;margin:0;">Au P'tit Paradis — administration du site</p>
</div>`;

  const texte = `Connexion à l'administration

${prenom ? `Bonjour ${prenom},` : 'Bonjour,'}

Votre code de connexion : ${code}
Valable 10 minutes.

Vous n'essayez pas de vous connecter ? Quelqu'un connaît votre mot de
passe. Ne communiquez ce code à personne et changez votre mot de passe.

Au P'tit Paradis — administration du site`;

  try {
    await envoyer({
      destinataire: email,
      sujet: `Code de connexion — ${code}`,
      html,
      texte
    }, env);
    return true;
  } catch (err) {
    console.error('Code de connexion non envoyé :', err.message);
    return false;
  }
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
  return diffuser(commande, mailClientAnnulation(commande, env), mailPatronAnnulation(commande), env);
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
