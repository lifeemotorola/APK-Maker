/* Small, local-only navigation layer. Analysis state stays mounted between pages. */
(function () {
  'use strict';
  var menu = document.getElementById('appMenu');
  var opener = document.getElementById('menuBtn');
  var links = document.querySelectorAll('[data-screen]');
  var current = 'home';
  function show(name, focus) {
    var target = document.getElementById('screen-' + name);
    if (!target) return;
    if (current === 'tuner' && name !== 'tuner') {
      document.getElementById('stopTunerBtn').click();
      document.getElementById('stopDroneBtn').click();
    }
    document.querySelectorAll('.screen').forEach(function (screen) {
      screen.hidden = screen !== target;
      screen.classList.toggle('hidden', screen !== target);
    });
    links.forEach(function (link) {
      if (link.dataset.screen === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    current = name;
    if (menu.open) menu.close();
    if (focus !== false) {
      target.querySelector('h2').focus();
      window.scrollTo(0, 0);
    }
  }
  opener.addEventListener('click', function () {
    menu.showModal();
    opener.setAttribute('aria-expanded', 'true');
  });
  document.getElementById('closeMenuBtn').addEventListener('click', function () { menu.close(); });
  menu.addEventListener('close', function () {
    opener.setAttribute('aria-expanded', 'false');
    opener.focus();
  });
  menu.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var buttons = menu.querySelectorAll('button:not(:disabled), a[href]');
    var first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  menu.addEventListener('click', function (event) {
    if (event.target !== menu) return;
    var bounds = menu.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) menu.close();
  });
  links.forEach(function (link) { link.addEventListener('click', function () { show(link.dataset.screen); }); });
  document.querySelectorAll('.back-home').forEach(function (button) {
    button.addEventListener('click', function () { show('home'); });
  });
  window.ChoirNavigation = { show: show };
})();
