// ============================================================
// ICONS — bibliothèques d'icônes du panel
// ============================================================

export const SVG_X = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>';

const _ibSvg = (inner) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const IB_ICONS = {
  up:     _ibSvg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  down:   _ibSvg('<path d="M12 5v14M5 12l7 7 7-7"/>'),
  eye:    _ibSvg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: _ibSvg('<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.16 2.96M6.6 6.6A13 13 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.5-1.2M3 3l18 18"/>'),
  edit:   _ibSvg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>'),
  trash:  _ibSvg('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>')
};
