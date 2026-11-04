/* WiFi Cam — control page (served by the phone itself on 127.0.0.1:8080 and
 * reachable from the LAN). Drives the camera via window.WifiCam and shows the
 * MJPEG preview from /stream. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    statePill: $('statePill'), streamUrl: $('streamUrl'), driverCmd: $('driverCmd'),
    copyBtn: $('copyBtn'), preview: $('preview'), previewOff: $('previewOff'),
    startBtn: $('startBtn'), stopBtn: $('stopBtn'), camSel: $('camSel'),
    resSel: $('resSel'), fpsSel: $('fpsSel'), torchBtn: $('torchBtn'), status: $('status'),
  };
  var N = window.WifiCam;

  var torchOn = false;

  function setStatus(msg, cls) {
    els.status.textContent = msg;
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  window.WifiCamEvents = {
    onError: function (msg) { setStatus('error: ' + msg, 'err'); },
  };

  function refreshUrl() {
    if (!N) return;
    var url = N.getStreamUrl();
    els.streamUrl.textContent = url;
    var ip = N.getLanIp();
    els.driverCmd.textContent = 'python wificam_driver.py --host ' + ip + ' --view';
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
        els.preview.src = '/stream?t=' + Date.now();
      } else if (!on && els.preview.src) {
        els.preview.removeAttribute('src');
      }
      setStatus('ip ' + s.ip + ':' + s.port + (on ? ' · ' + s.info + ' · clients ' + s.clients : ' · idle'), on ? 'ok' : '');
    }).catch(function () {
      setStatus('status poll failed', 'err');
    });
  }

  els.startBtn.addEventListener('click', function () {
    if (!N) { setStatus('native bridge missing', 'err'); return; }
    var res = els.resSel.value.split('x');
    var w = parseInt(res[0], 10), h = parseInt(res[1], 10);
    var fps = parseInt(els.fpsSel.value, 10);
    setStatus('starting camera...');
    var r = N.startCamera(els.camSel.value, w, h, fps);
    if (r === 'pending-permission') setStatus('waiting for camera permission...');
    else if (r === 'started') { setStatus('streaming', 'ok'); els.preview.src = '/stream?t=' + Date.now(); }
    else setStatus('camera failed to start', 'err');
    setTimeout(pollStatus, 800);
  });

  els.stopBtn.addEventListener('click', function () {
    if (N) N.stopCamera();
    torchOn = false;
    els.torchBtn.textContent = 'Torch: off';
    els.preview.removeAttribute('src');
    pollStatus();
  });

  els.torchBtn.addEventListener('click', function () {
    torchOn = !torchOn;
    if (N) N.setTorch(torchOn);
    els.torchBtn.textContent = 'Torch: ' + (torchOn ? 'on' : 'off');
  });

  els.copyBtn.addEventListener('click', function () {
    var text = els.streamUrl.textContent;
    function done() { setStatus('stream URL copied — paste it in the computer driver', 'ok'); }
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
