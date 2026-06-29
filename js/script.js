// ============================================================
// AU P'TIT PARADIS — interactions
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  /* ---- Header : fond au scroll ---- */
  const header = document.querySelector('.site-header');
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 30);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- Menu mobile ---- */
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('main-nav');

  navToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  mainNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mainNav.classList.remove('is-open');
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

  /* ---- Lightbox photos produits ---- */
  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('role', 'dialog');
  lightbox.innerHTML = `
    <button class="lightbox-close" aria-label="Fermer">✕</button>
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
