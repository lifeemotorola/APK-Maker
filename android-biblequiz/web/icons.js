/* ============================================================================
 * icons.js — inline SVG icon set for Bible Quiz (no emoji anywhere in the UI).
 * Usage in app.js:  I('bolt')          -> <svg>…</svg> string (safe in innerHTML)
 *                   I('play', 'big')    -> with an extra class
 * Filled icons (play/pause/bolt/starFill) carry f:1 and render fill=currentColor.
 * ==========================================================================*/
(function () {
'use strict';

// name -> { d: inner SVG markup, f: filled? }
var ICONS = {
  home:        { d: '<path d="M3 11l9-8 9 8"/><path d="M5 9.8V21h14V9.8"/><path d="M10 21v-6h4v6"/>' },
  chart:       { d: '<path d="M6 20v-5"/><path d="M12 20V8"/><path d="M18 20v-9"/><path d="M3 20h18"/>' },
  star:        { d: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>' },
  starFill:    { d: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>', f: 1 },
  search:      { d: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>' },
  gear:        { d: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>' },
  bolt:        { d: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>', f: 1 },
  zap:         { d: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>' },
  flag:        { d: '<path d="M5 21V4"/><path d="M5 4h13l-2.8 3.8L18 11.5H5"/>' },
  sun:         { d: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>' },
  skull:       { d: '<path d="M12 2a8 8 0 0 0-8 8c0 2.6 1.2 4.4 3 5.6V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3.4c1.8-1.2 3-3 3-5.6a8 8 0 0 0-8-8z"/><path d="M9 11h.01M15 11h.01"/><path d="M9.5 16.5c.8.8 4.2.8 5 0"/>' },
  leaf:        { d: '<path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 16-10 0 12-5 16-9 17z"/><path d="M4 21c3-5 7-8 11-10"/>' },
  hash:        { d: '<path d="M9 3L7 21M17 3l-2 18M4 8h17M3 16h17"/>' },
  target:      { d: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>' },
  cap:         { d: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/><path d="M22 9v6"/>' },
  crown:       { d: '<path d="M3 17l-1.5-9L7 12l5-8 5 8 5.5-4L21 17H3z"/><path d="M4 21h16"/>' },
  flame:       { d: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>' },
  sparkles:    { d: '<path d="M12 4l1.7 4.6L18.5 10l-4.8 1.4L12 16l-1.7-4.6L5.5 10l4.8-1.4L12 4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/><path d="M5 16l.6 1.7L7.5 18l-1.9.6L5 20.5l-.6-1.9L2.5 18l1.9-.3L5 16z"/>' },
  bulb:        { d: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.9 10.6c.7.6 1.1 1.4 1.2 2.4h5.4c.1-1 .5-1.8 1.2-2.4A6 6 0 0 0 12 3z"/>' },
  calendar:    { d: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>' },
  compass:     { d: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>' },
  globe:       { d: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z"/>' },
  trophy:      { d: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 6H4.5A1.5 1.5 0 0 0 6 11h1M17 6h2.5A1.5 1.5 0 0 1 18 11h-1"/>' },
  medal:       { d: '<circle cx="12" cy="14" r="6"/><path d="M8.5 9L6 2h4l2 4 2-4h4l-2.5 7"/>' },
  smile:       { d: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2.5 4 2.5 4-2.5 4-2.5"/><path d="M9 9.5h.01M15 9.5h.01"/>' },
  meh:         { d: '<circle cx="12" cy="12" r="9"/><path d="M8 15h8"/><path d="M9 9.5h.01M15 9.5h.01"/>' },
  frown:       { d: '<circle cx="12" cy="12" r="9"/><path d="M16 16s-1.5-2.5-4-2.5-4 2.5-4 2.5"/><path d="M9 9.5h.01M15 9.5h.01"/>' },
  trending:    { d: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>' },
  check:       { d: '<path d="M20 6L9 17l-5-5"/>' },
  x:           { d: '<path d="M18 6L6 18M6 6l12 12"/>' },
  clock:       { d: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>' },
  play:        { d: '<path d="M7 4.5l12 7.5-12 7.5v-15z"/>', f: 1 },
  pause:       { d: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', f: 1 },
  skip:        { d: '<path d="M6 4.5l10 7.5-10 7.5v-15z"/><path d="M17 4h3v16h-3z"/>', f: 1 },
  refresh:     { d: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>' },
  book:        { d: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2V4z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7V4z"/>' },
  trash:       { d: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/><path d="M10 11v6M14 11v6"/>' },
  chevronRight:{ d: '<path d="M9 5l7 7-7 7"/>' },
  chevronLeft: { d: '<path d="M15 5l-7 7 7 7"/>' },
  phone:       { d: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M10.5 18.5h3"/>' },
  image:       { d: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 15.5l-5-5-9 8.5"/>' },
  plus:        { d: '<path d="M12 5v14M5 12h14"/>' },
  eye:         { d: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>' },
  power:       { d: '<path d="M12 2.5V11"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>' },
  external:    { d: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>' },
  warning:     { d: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>' },
  lock:        { d: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' },
  hourglass:   { d: '<path d="M6 2h12M6 22h12"/><path d="M8 2v4l4 5 4-5V2"/><path d="M8 22v-4l4-5 4 5v4"/>' },
  checkCircle: { d: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>' },
  camera:      { d: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>' },
  clipboard:   { d: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M9 11h6M9 15h6"/>' },
  film:        { d: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M7 4v16M17 4v16M2.5 12h19M2.5 8h4.5M2.5 16h4.5M17 8h4.5M17 16h4.5"/>' },
  volume:      { d: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9.5 9.5 0 0 1 0 14"/>' },
  music:       { d: '<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>' },
  moon:        { d: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>' },
  help:        { d: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.9 2.9 0 0 1 5.6.9c0 1.9-2.8 2.4-2.8 4.1"/><path d="M12 17.5h.01"/>' },
  tl:          { d: '<path d="M17 17L7 7"/><path d="M7 15V7h8"/>' },
  tr:          { d: '<path d="M7 17L17 7"/><path d="M9 7h8v8"/>' },
  bl:          { d: '<path d="M17 7L7 17"/><path d="M15 17H7V9"/>' },
  br:          { d: '<path d="M7 7l10 10"/><path d="M17 9v8H9"/>' },
};

/** Returns an inline <svg> string for icon `name` (unknown -> help). */
function I(name, cls) {
  var ic = ICONS[name] || ICONS.help;
  var fill = ic.f ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" ' + fill + ' aria-hidden="true">' + ic.d + '</svg>';
}

if (typeof window !== 'undefined') { window.BQ_ICONS = ICONS; window.I = I; }
if (typeof module !== 'undefined') module.exports = { ICONS: ICONS, I: I };
})();
