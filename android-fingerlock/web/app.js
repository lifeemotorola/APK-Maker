/* FingerLock — lock screen page. Talks to the native side via window.FingerLock
 * (addJavascriptInterface). Results arrive through window.FingerLockEvents. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    lockPane: $('lockPane'), homePane: $('homePane'), statePill: $('statePill'),
    unlockBtn: $('unlockBtn'), lockBtn: $('lockBtn'), attempts: $('attempts'),
    msg: $('msg'), enrollHint: $('enrollHint'), clock: $('clock'), date: $('date'),
  };
  var N = window.FingerLock;

  function setMsg(text, ok) {
    els.msg.textContent = text || '';
    els.msg.className = 'msg' + (ok ? ' ok' : '');
  }

  function renderAttempts(state) {
    var left = state.maxAttempts - state.attempts;
    els.attempts.textContent = left > 0 ? 'attempts left: ' + left : '';
  }

  function renderState(state) {
    if (!state) return;
    var locked = !!state.locked;
    els.lockPane.classList.toggle('hidden', !locked);
    els.homePane.classList.toggle('hidden', locked);
    els.statePill.textContent = locked ? 'LOCKED' : 'UNLOCKED';
    els.statePill.className = 'pill ' + (locked ? 'locked' : 'open');
    els.enrollHint.classList.toggle('show', !state.enrolled);
    els.unlockBtn.disabled = !state.enrolled || state.lockoutLeftSec > 0;
    if (state.lockoutLeftSec > 0) setMsg('too many attempts — wait ' + state.lockoutLeftSec + 's');
    renderAttempts(state);
  }

  window.FingerLockEvents = {
    onResult: function (ok, message, state) {
      setMsg(message, ok);
      renderState(state);
      if (ok) setMsg('unlocked', true);
    },
    onState: function (state) {
      renderState(state);
    },
  };

  els.unlockBtn.addEventListener('click', function () {
    if (!N) { setMsg('native bridge missing'); return; }
    setMsg('touch the fingerprint sensor...');
    N.authenticate();
  });

  els.lockBtn.addEventListener('click', function () {
    if (N) N.lock();
    setMsg('');
  });

  function tickClock() {
    var d = new Date();
    els.clock.textContent = d.toLocaleTimeString();
    els.date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  tickClock();
  setInterval(tickClock, 1000);

  if (N) {
    renderState(JSON.parse(N.getState()));
  } else {
    setMsg('native bridge missing');
  }
})();
