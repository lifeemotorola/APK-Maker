/* WiFi Cam — control page (served by the phone at http://<phone-ip>:8080/).
 * Controls the camera through the /api/* HTTP endpoints and shows the MJPEG
 * preview from /stream. Works from any browser on the WiFi. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    statePill: $('statePill'), streamUrl: $('streamUrl'), driverCmd: $('driverCmd'),
    copyBtn: $('copyBtn'), preview: $('preview'), previewOff: $('previewOff'),
    startBtn: $('startBtn'), stopBtn: $('stopBtn'), camSel: $('camSel'),
    resSel: $('resSel'), fpsSel: $('fpsSel'), torchBtn: $('torchBtn'), status: $('status'),
  };

  var host = location.hostname || '127.0.0.1';
  var port = location.port || '8080';
  var torchOn = false;

  function streamUrl() { return 'http://' + host + ':' + port + '/stream'; }

  function setStatus(msg, cls) {
    els.status.textContent = msg;
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function refreshUrl() {
    els.streamUrl.textContent = streamUrl();
    els.driverCmd.textContent = 'python3 wificam_driver.py --host ' + host + ' --view   (OBS: --virtual-cam /dev/video0)';
  }

  function pollStatus() {
    fetch('/status').then(function (r) { return r.json(); }).then(function (s) {
      var on = !!s.streaming;
      els.statePill.textContent = on ? 'streaming' : 'off';
      els.statePill.classList.toggle('on', on);
      els.startBtn.disabled = on;
      els.stopBtn.disabled = !on;
      els.previewOff.classList.toggle('hidden', on);
      if (on && !els.preview.src) {
        els.preview.src = streamUrl() + '?t=' + Date.now();
      } else if (!on && els.preview.src) {
        els.preview.removeAttribute('src');
      }
      setStatus('ip ' + s.ip + ':' + s.port + (on ? ' · ' + s.info + ' · clients ' + s.clients : ' · idle'), on ? 'ok' : '');
    }).catch(function () {
      setStatus('status poll failed', 'err');
    });
  }

  els.startBtn.addEventListener('click', function () {
    var res = els.resSel.value.split('x');
    var w = parseInt(res[0], 10), h = parseInt(res[1], 10);
    var fps = parseInt(els.fpsSel.value, 10);
    setStatus('starting camera...');
    fetch('/api/start?cam=' + encodeURIComponent(els.camSel.value)
        + '&w=' + w + '&h=' + h + '&fps=' + fps)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) {
          setStatus('streaming', 'ok');
          els.preview.src = streamUrl() + '?t=' + Date.now();
        } else if (j.permission === false) {
          setStatus('camera permission not granted on the phone', 'err');
        } else {
          setStatus('camera failed to start', 'err');
        }
        pollStatus();
      })
      .catch(function () { setStatus('start request failed', 'err'); });
  });

  els.stopBtn.addEventListener('click', function () {
    fetch('/api/stop').then(function () {
      torchOn = false;
      els.torchBtn.textContent = 'Torch: off';
      els.preview.removeAttribute('src');
      pollStatus();
    });
  });

  els.torchBtn.addEventListener('click', function () {
    torchOn = !torchOn;
    fetch('/api/torch?on=' + (torchOn ? '1' : '0')).then(function () {
      els.torchBtn.textContent = 'Torch: ' + (torchOn ? 'on' : 'off');
    });
  });

  els.copyBtn.addEventListener('click', function () {
    var text = els.streamUrl.textContent;
    function done() { setStatus('stream URL copied — use it in OBS (Browser source) or the driver', 'ok'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { setStatus('copy failed — select the URL manually', 'err'); }
      document.body.removeChild(ta);
    }
  });

  refreshUrl();
  pollStatus();
  setInterval(pollStatus, 2500);
})();
