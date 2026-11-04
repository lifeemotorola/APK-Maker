/* ============================================================================
 * JS Mastery — inline SVG icon library (no emoji anywhere).
 * Usage: I('code') -> '<svg class="ico" ...>...</svg>' ; I('play','lg') adds a
 * size class. Stroke-based, inherits currentColor, 24x24 viewBox.
 * ==========================================================================*/
(function () {
  'use strict';
  var P = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>',
    book: '<path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z"/><path d="M5 17.5A2 2 0 0 1 7 15.5h11"/><path d="M9 8h6"/>',
    code: '<path d="M8.5 7 4 12l4.5 5M15.5 7 20 12l-4.5 5"/><path d="M13 5l-2.5 14"/>',
    play: '<path fill="currentColor" stroke="none" d="M8 5.5v13l11-6.5z"/>',
    check: '<path d="M4.5 12.5 10 18 19.5 6.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevL: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    chevR: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    arrowR: '<path d="M4 12h15"/><path d="M13.5 6 19.5 12l-6 6"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.5a2.5 2.5 0 0 0 2.6 3M17 5.5h2.5a2.5 2.5 0 0 1-2.6 3"/><path d="M12 14v3M8.5 20h7M10 17h4"/>',
    medal: '<circle cx="12" cy="14.5" r="5"/><path d="M8.5 10 6 3.5h4L12 8l2-4.5h4L15.5 10"/><path d="M12 12.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 14.3l2-.3z"/>',
    print: '<path d="M7 8V3.5h10V8"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 13.5h10V21H7z"/>',
    rocket: '<path d="M12 3.5c3.5 1.5 5.5 5 5.5 9l-2.5 2.5h-6L6.5 12.5c0-4 2-7.5 5.5-9z"/><circle cx="12" cy="10" r="1.8"/><path d="M9 15.5 7 20l3-1.5M15 15.5 17 20l-3-1.5M12 17v3"/>',
    bulb: '<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3.5a6 6 0 0 1 3.5 10.8c-.8.6-1 1.4-1 2.2h-5c0-.8-.2-1.6-1-2.2A6 6 0 0 1 12 3.5z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3.5V8h-4.5"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
    starFill: '<path fill="currentColor" stroke="none" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
    shuffle: '<path d="M3 7h4l10 10h4"/><path d="M3 17h4l2.5-2.5"/><path d="M13.5 9.5 17 7h4"/><path d="M18 4.5 21 7l-3 2.5M18 14.5 21 17l-3 2.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4.5 6.5h15"/><path d="M9 6V4.5h6V6"/><path d="M6.5 6.5 7.5 20h9l1-13.5"/><path d="M10 10v6M14 10v6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M4 5l16 14"/><path d="M10 6.2A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.6M6.6 7.4A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    flame: '<path d="M12 3.5s5.5 5 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2 1-3.8 2-5.2.3 1.4 1 2.2 2 2.6-.3-2.4.4-5 1.5-6.9z"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.2A2.6 2.6 0 0 1 12 7.5c1.5 0 2.6 1 2.6 2.4 0 1.9-2.6 2.2-2.6 4.1"/><path d="M12 17h.01" stroke-width="2.4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.5h.01" stroke-width="2.4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>',
    award: '<circle cx="12" cy="9" r="5.5"/><path d="M8.8 13.5 7 21l5-2.6L17 21l-1.8-7.5"/>'
  };
  function I(name, cls) {
    var body = P[name] || P.help;
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + body + '</svg>';
  }
  if (typeof window !== 'undefined') { window.JSM_ICONS = P; window.I = I; }
  if (typeof module !== 'undefined' && module.exports) module.exports = { ICONS: P, I: I };
})();
