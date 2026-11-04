/* ============================================================================
 * Community Market — inline SVG icon library (no emoji anywhere).
 * Usage: I('store') -> '<svg class="ico" ...>...</svg>' ; I('bus','lg') adds a
 * size class. Icons are stroke-based, inherit currentColor, 24x24 viewBox.
 * ==========================================================================*/
(function () {
  'use strict';
  var P = {
    // ui
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    pin: '<path d="M12 21s-6.5-5.4-6.5-10.2A6.5 6.5 0 0 1 12 4.3a6.5 6.5 0 0 1 6.5 6.5C18.5 15.6 12 21 12 21z"/><circle cx="12" cy="10.8" r="2.3"/>',
    phone: '<path d="M5 4h4l1.5 4.5L8 10a12 12 0 0 0 6 6l1.5-2.5L20 15v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bookmark: '<path d="M6.5 4h11v16l-5.5-3.6L6.5 20z"/>',
    bookmarkFill: '<path fill="currentColor" stroke="none" d="M6.5 4h11v16l-5.5-3.6L6.5 20z"/>',
    tag: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.6"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.5 14.6c2.4.2 4.3 1.8 4.9 4.4"/>',
    board: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4.5"/>',
    bus: '<rect x="4" y="4" width="16" height="13" rx="2.5"/><path d="M4 10.5h16"/><circle cx="8" cy="19.5" r="1.7"/><circle cx="16" cy="19.5" r="1.7"/><path d="M7 14h.01M17 14h.01" stroke-width="2.4"/>',
    chevL: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    chevR: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    arrowR: '<path d="M4 12h15"/><path d="M13.5 6 19.5 12l-6 6"/>',
    check: '<path d="M4.5 12.5 10 18 19.5 6.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4.5 6.5h15"/><path d="M9 6V4.5h6V6"/><path d="M6.5 6.5 7.5 20h9l1-13.5"/><path d="M10 10v6M14 10v6"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 15.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.3 10.8 15.2 6.7M8.3 13.2l6.9 4.1"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
    starFill: '<path fill="currentColor" stroke="none" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.2A2.6 2.6 0 0 1 12 7.5c1.5 0 2.6 1 2.6 2.4 0 1.9-2.6 2.2-2.6 4.1"/><path d="M12 17h.01" stroke-width="2.4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.5h.01" stroke-width="2.4"/>',
    // categories
    store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5h16v2.2a2.4 2.4 0 0 1-4.8 0 2.4 2.4 0 0 1-3.2 2.2 2.4 2.4 0 0 1-3.2-2.2 2.4 2.4 0 0 1-4.8 0z"/><path d="M5.5 13.5V20h13v-6.5"/><path d="M10 20v-4.5h4V20"/>',
    food: '<path d="M5 4v6a2.5 2.5 0 0 0 5 0V4"/><path d="M7.5 4v16"/><path d="M17 4c-1.8 1-3 3.2-3 6v10"/>',
    medical: '<rect x="4" y="6" width="16" height="14" rx="2.5"/><path d="M12 10v6M9 13h6"/><path d="M9 6V4h6v2"/>',
    wrench: '<path d="M14.5 6.5a4.5 4.5 0 0 0-6 5.6L4 16.6a2 2 0 0 0 2.8 2.8l4.5-4.5a4.5 4.5 0 0 0 5.6-6L14 12l-2-2z"/>',
    money: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6.5 9.5h.01M17.5 14.5h.01" stroke-width="2.2"/>',
    cap: '<path d="M3 9.5 12 5l9 4.5-9 4.5z"/><path d="M7 11.8V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.2"/><path d="M21 9.5V15"/>',
    scissors: '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.7 8 20 19M8.7 16 20 5"/>',
    homeIco: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    drop: '<path d="M12 3.5s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
    wifiOff: '<path d="M4 9.5C8 6 16 6 20 9.5M6.8 12.8c3-2.6 7.4-2.6 10.4 0M9.6 16c1.4-1.2 3.4-1.2 4.8 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/><path d="M4 4l16 16"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z"/><path d="M9 11.8l2.2 2.2L15.5 9.5"/>'
  };
  var FALLBACK = P.help;
  function I(name, cls) {
    var body = P[name] || FALLBACK;
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + body + '</svg>';
  }
  if (typeof window !== 'undefined') { window.MK_ICONS = P; window.I = I; }
  if (typeof module !== 'undefined' && module.exports) module.exports = { ICONS: P, I: I };
})();
