// ============================================================
// AU P'TIT PARADIS — interactions
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  /* ---- Header : scroll ---- */
  const header = document.querySelector('.site-header');
  const scrollProgress = header.querySelector('.scroll-progress');

  const onScroll = () => {
    const scrolled = window.scrollY;
    header.classList.toggle('is-scrolled', scrolled > 50);

    if (scrollProgress) {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docH > 0 ? Math.min((scrolled / docH) * 100, 100) : 0;
      scrollProgress.style.width = pct + '%';
    }
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- Menu mobile ---- */
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobile-nav');

  navToggle.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('is-open');
    mobileNav.setAttribute('aria-hidden', String(!isOpen));
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('is-open');
      mobileNav.setAttribute('aria-hidden', 'true');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---- Révélation au scroll ---- */
  const revealTargets = document.querySelectorAll(
    '.card, .histoire-text, .histoire-visual, .horaires-col, .contact-inner'
  );
  revealTargets.forEach(el => el.classList.add('reveal'));

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    revealTargets.forEach(el => observer.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.add('is-visible'));
  }

  /* ---- Année dynamique dans le footer ---- */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---- Horaires du footer : recopiés du tableau + jour courant mis en avant ----
     Appelé aussi par site-data.js une fois les horaires de l'admin chargés.
     Les pages sans tableau d'horaires (« Commander ») ont quand même un pied
     de page à remplir : elles passent les lignes directement. */
  window.syncFooterHours = function syncFooterHours(rowsFournies) {
    const list = document.getElementById('footerHours');
    if (!list) return;

    let rows = rowsFournies;
    if (!rows) {
      const tbody = document.getElementById('hoursTableBody');
      if (!tbody) return;
      rows = [...tbody.querySelectorAll('tr')].map(tr => ({
        day:  tr.querySelector('th')?.textContent.trim() || '',
        time: tr.querySelector('td')?.textContent.trim() || ''
      }));
    }

    rows = rows
      .map(r => ({ day: r.day || '', time: r.time ?? r.hours ?? '' }))
      .filter(r => r.day);
    if (!rows.length) return;

    const today = todayIndex();
    list.innerHTML = rows.map(r => {
      const cls = matchesDay(r.day, today) ? ' class="is-today"' : '';
      return `<li${cls}><span class="fh-day">${escapeHTML(r.day)}</span>` +
             `<span class="fh-time">${escapeHTML(r.time)}</span></li>`;
    }).join('');
  };

  const DAYS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];

  function todayIndex() { return new Date().getDay(); }

  function normalize(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /* Gère « Mardi », « Mardi — Vendredi », « Samedi et dimanche », « Lundi, jeudi »… */
  function matchesDay(label, dayIdx) {
    const txt = normalize(label);
    const found = DAYS
      .map((d, i) => ({ i, pos: txt.indexOf(d) }))
      .filter(d => d.pos !== -1)
      .sort((a, b) => a.pos - b.pos);
    if (!found.length) return false;

    const isRange = /[–—-]|\ba\b|\bau\b|\bjusqu/.test(txt);
    if (isRange && found.length >= 2) {
      let start = found[0].i, end = found[found.length - 1].i;
      // La semaine commence lundi : un intervalle peut passer par dimanche.
      const span = (end - start + 7) % 7;
      return ((dayIdx - start + 7) % 7) <= span;
    }
    return found.some(d => d.i === dayIdx);
  }

  function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  window.syncFooterHours();

  /* ---- Ouvert / fermé en temps réel ----
     Même source que le reste : le tableau des horaires. Rien à saisir en plus
     dans l'admin, le badge suit automatiquement les horaires publiés. */
  const badge = document.getElementById('openBadge');

  /* « 7h00 – 13h30 · 15h30 – 19h30 » -> [{start:420,end:810},{start:930,end:1170}] */
  function parseRanges(timeStr) {
    if (!timeStr || /ferm/i.test(normalize(timeStr))) return [];
    return timeStr.split(/[·,;]| et /i).map(seg => {
      // insensible à la casse : l'admin écrit aussi bien « 20h00 » que « 20H00 »
      const t = [...seg.matchAll(/(\d{1,2})\s*[h:]\s*(\d{2})?/gi)]
        .map(m => Number(m[1]) * 60 + Number(m[2] || 0));
      return t.length >= 2 ? { start: t[0], end: t[t.length - 1] } : null;
    }).filter(Boolean);
  }

  /* Horaires par jour de la semaine (0 = dimanche, comme Date#getDay) */
  function weekSchedule() {
    const tbody = document.getElementById('hoursTableBody');
    if (!tbody) return null;
    const week = [[], [], [], [], [], [], []];
    tbody.querySelectorAll('tr').forEach(tr => {
      const day = tr.querySelector('th')?.textContent.trim() || '';
      const ranges = parseRanges(tr.querySelector('td')?.textContent.trim());
      if (!day || !ranges.length) return;
      for (let d = 0; d < 7; d++) if (matchesDay(day, d)) week[d].push(...ranges);
    });
    week.forEach(r => r.sort((a, b) => a.start - b.start));
    return week.some(r => r.length) ? week : null;
  }

  function fmtTime(mins) {
    return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
  }

  window.refreshOpenStatus = function refreshOpenStatus() {
    if (!badge) return;
    const week = weekSchedule();
    if (!week) { badge.hidden = true; return; }

    const now = new Date();
    const day = now.getDay();
    const mins = now.getHours() * 60 + now.getMinutes();

    let state = '', detail = '';
    const current = week[day].find(r => mins >= r.start && mins < r.end);

    if (current) {
      state = 'Ouvert';
      detail = `ferme à ${fmtTime(current.end)}`;
    } else {
      state = 'Fermé';
      const laterToday = week[day].find(r => r.start > mins);
      if (laterToday) {
        detail = `ouvre à ${fmtTime(laterToday.start)}`;
      } else {
        for (let i = 1; i <= 7; i++) {
          const d = (day + i) % 7;
          if (!week[d].length) continue;
          const when = i === 1 ? 'demain' : DAYS[d];
          detail = `ouvre ${when} à ${fmtTime(week[d][0].start)}`;
          break;
        }
      }
    }

    badge.classList.toggle('is-open', !!current);
    badge.classList.toggle('is-closed', !current);
    badge.querySelector('.open-label').innerHTML =
      `${escapeHTML(state)}${detail ? `<span class="open-detail"> · ${escapeHTML(detail)}</span>` : ''}`;
    badge.setAttribute('aria-label', `${state}${detail ? ' — ' + detail : ''} — voir les horaires`);
    badge.hidden = false;
  };

  window.refreshOpenStatus();
  setInterval(() => window.refreshOpenStatus(), 60000);

  /* ---- Barre d'action mobile : apparaît une fois le hero passé ---- */
  const mobileActions = document.getElementById('mobileActions');
  if (mobileActions) {
    const toggleActions = () => {
      mobileActions.classList.toggle('is-visible', window.scrollY > window.innerHeight * 0.6);
    };
    toggleActions();
    window.addEventListener('scroll', toggleActions, { passive: true });
  }

  /* ---- Lightbox photos produits ---- */
  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('role', 'dialog');
  lightbox.innerHTML = `
    <button class="lightbox-close" aria-label="Fermer"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2l-10 10"/></svg></button>
    <div class="lightbox-inner">
      <img class="lightbox-img" src="" alt="">
      <p class="lightbox-caption"></p>
    </div>`;
  document.body.appendChild(lightbox);

  const lbImg = lightbox.querySelector('.lightbox-img');
  const lbCaption = lightbox.querySelector('.lightbox-caption');

  function openLightbox(src, alt) {
    lbImg.src = src;
    lbImg.alt = alt;
    lbCaption.textContent = alt;
    lbCaption.hidden = !alt;
    lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    lightbox.querySelector('.lightbox-close').focus();
  }

  function closeLightbox() {
    lightbox.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { lbImg.src = ''; }, 300);
  }

  document.addEventListener('click', e => {
    const img = e.target.closest('.spec-produit-img');
    if (img) openLightbox(img.src, img.alt);
  });

  lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

});
