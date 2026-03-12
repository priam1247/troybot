/* TROYBOT - Frontend */
'use strict';

function $(id) { return document.getElementById(id); }

var statusDot    = $('statusDot');
var statusLabel  = $('statusLabel');
var uptimeVal    = $('uptimeVal');
var msgCountEl   = $('msgCount');
var chatMessages = $('chatMessages');
var commandForm  = $('commandForm');
var commandInput = $('commandInput');
var sendBtn      = $('sendBtn');
var clearBtn     = $('clearBtn');

var localCount = 0;
var seenIds    = {};

/* SoundCloud player state */
var scWidget       = null;
var scProgressTimer= null;
var scDuration     = 0;
var scPosition     = 0;
var scPlaying      = false;
var scPlaylistOpen = false;
var scQueue        = { tracks: [], index: 0, shuffle: false, repeat: false };

/* ---- HELPERS ---- */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime() { return new Date().toLocaleTimeString(); }

function formatUptime(s) {
  if (!s) return '--';
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = Math.floor(s % 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

function formatMs(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  var s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ---- STATUS ---- */
function fetchStatus() {
  fetch('/api/status').then(function(r) { return r.json(); }).then(function(data) {
    if (statusDot) statusDot.className = 'status-dot online';
    if (statusLabel) statusLabel.textContent = 'ONLINE';
    if (uptimeVal) uptimeVal.textContent = formatUptime(data.uptime);
  }).catch(function() {
    if (statusDot) statusDot.className = 'status-dot offline';
    if (statusLabel) statusLabel.textContent = 'OFFLINE';
  });
}

/* ---- MESSAGES ---- */
function fetchMessages() {
  fetch('/api/messages?limit=20').then(function(r) { return r.json(); }).then(function(data) {
    var msgs = (data.messages || []).reverse();
    msgs.forEach(function(m) {
      if (!seenIds[m.id]) {
        seenIds[m.id] = true;
        renderMessage(m);
        localCount++;
      }
    });
    if (msgCountEl) msgCountEl.textContent = localCount;
    scrollToBottom();
  }).catch(function() {});
}

/* ---- RENDER MESSAGE ---- */
function renderMessage(msg) {
  var isUser  = msg.source === 'web';
  var isError = msg.type === 'error';
  var div = document.createElement('div');
  div.className = 'message ' + (isUser ? 'user-message' : isError ? 'error-message' : 'bot-message');
  div.style.opacity = '0';
  div.innerHTML =
    '<div class="msg-meta">' +
      '<span class="msg-source">' + (isUser ? 'YOU' : isError ? 'ERROR' : 'TROY BOT') + '</span>' +
      '<span class="msg-time">' + formatTime() + '</span>' +
    '</div>' +
    '<div class="msg-content">' + escapeHtml(msg.content) + '</div>';
  chatMessages.appendChild(div);
  requestAnimationFrame(function() { div.style.opacity = '1'; div.style.transition = 'opacity 0.3s'; });
  localCount++;
  if (msgCountEl) msgCountEl.textContent = localCount;
  scrollToBottom();
}

function showTyping() {
  var d = document.createElement('div');
  d.className = 'message bot-message typing-indicator';
  d.id = 'typingIndicator';
  d.innerHTML = '<span></span><span></span><span></span>';
  chatMessages.appendChild(d);
  scrollToBottom();
}
function removeTyping() { var t = $('typingIndicator'); if (t) t.remove(); }

/* ---- SEND COMMAND ---- */
function sendCommand(command) {
  sendBtn.disabled = true;
  commandInput.disabled = true;
  renderMessage({ source: 'web', content: command, timestamp: new Date().toISOString() });
  showTyping();

  fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: command }),
  }).then(function(res) {
    return res.json().then(function(data) { return { data: data, ok: res.ok }; });
  }).then(function(r) {
    removeTyping();
    var data = r.data;
    if (data.cleared) {
      chatMessages.innerHTML = '';
      seenIds = {}; localCount = 0;
      if (msgCountEl) msgCountEl.textContent = 0;
      renderMessage({ source: 'troy-bot', content: 'Chat cleared. Fresh start!', timestamp: new Date().toISOString() });
    } else if (data.trackInfo) {
      if (data.botEntry) renderMessage(data.botEntry);
      renderSoundCloudPlayer(data.trackInfo);
    } else if (data.botEntry) {
      renderMessage(data.botEntry);
    } else if (!r.ok) {
      renderMessage({ source: 'error', content: data.error || 'Unknown error', type: 'error', timestamp: new Date().toISOString() });
    }
  }).catch(function() {
    removeTyping();
    renderMessage({ source: 'error', content: 'Network error - could not reach server.', type: 'error', timestamp: new Date().toISOString() });
  }).finally(function() {
    sendBtn.disabled = false;
    commandInput.disabled = false;
    commandInput.focus();
  });
}

/* ---- SOUNDCLOUD PLAYER ---- */
function scPlay(index) {
  if (!scQueue.tracks.length) return;
  scQueue.index = index;
  var track  = scQueue.tracks[index];
  var iframe = $('sc-iframe');
  if (!iframe) return;
  iframe.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(track.trackUrl) +
    '&color=%2300e5ff&auto_play=true&hide_related=true&show_comments=false&show_user=true&visual=true&buying=false&sharing=false&download=false';
  var titleEl  = $('sc-title');
  var authorEl = $('sc-author');
  var artEl    = $('sc-art');
  if (titleEl)  titleEl.textContent  = track.title;
  if (authorEl) authorEl.textContent = track.author;
  if (artEl && track.thumbnail) artEl.style.backgroundImage = 'url(' + track.thumbnail + ')';
  scPosition = 0; scDuration = 0;
  updateProgress(0, 0);
  startProgressSim(track);
  updateQueueHighlight();
  updateQueueCount();
  setTimeout(bindWidget, 1500);
}

function scNext() {
  if (!scQueue.tracks.length) return;
  var next = scQueue.shuffle
    ? Math.floor(Math.random() * scQueue.tracks.length)
    : (scQueue.index + 1) % scQueue.tracks.length;
  scPlay(next);
}

function scPrev() {
  if (!scQueue.tracks.length) return;
  var prev = scQueue.index - 1;
  if (prev < 0) prev = scQueue.tracks.length - 1;
  scPlay(prev);
}

function updateQueueHighlight() {
  var items = document.querySelectorAll('.sc-queue-item');
  items.forEach(function(el, i) { el.classList.toggle('active', i === scQueue.index); });
}

function updateQueueCount() {
  var el = $('sc-queue-pos');
  if (el) el.textContent = (scQueue.index + 1) + ' / ' + scQueue.tracks.length;
}

function updateProgress(pos, dur) {
  var fill  = $('sc-progress-fill');
  var posEl = $('sc-pos');
  var durEl = $('sc-dur');
  if (!fill) return;
  var pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  fill.style.width = pct + '%';
  if (posEl) posEl.textContent = formatMs(pos);
  if (durEl) durEl.textContent = formatMs(dur);
}

function startProgressSim(track) {
  if (scProgressTimer) clearInterval(scProgressTimer);
  var dur = 0;
  if (track.duration) {
    var parts = track.duration.split(':');
    if (parts.length === 2) dur = (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
  }
  scDuration = dur || 240000;
  scPosition = 0;
  scPlaying  = true;
  scProgressTimer = setInterval(function() {
    if (!scPlaying) return;
    scPosition += 1000;
    if (scPosition >= scDuration) {
      clearInterval(scProgressTimer);
      scProgressTimer = null;
      if (scQueue.repeat) scPlay(scQueue.index);
      else scNext();
      return;
    }
    updateProgress(scPosition, scDuration);
  }, 1000);
}

function bindWidget() {
  var iframe = $('sc-iframe');
  if (!iframe || typeof SC === 'undefined') return;
  try {
    scWidget = SC.Widget(iframe);
    scWidget.bind(SC.Widget.Events.PLAY_PROGRESS, function(e) {
      scPosition = e.currentPosition;
      if (e.relativePosition > 0) scDuration = scPosition / e.relativePosition;
      updateProgress(scPosition, scDuration);
      if (scProgressTimer) { clearInterval(scProgressTimer); scProgressTimer = null; }
    });
    scWidget.bind(SC.Widget.Events.FINISH, function() {
      if (scQueue.repeat) scPlay(scQueue.index); else scNext();
    });
  } catch(e) {}
}

function initProgressClick() {
  var track = $('sc-progress-track');
  if (!track) return;
  track.addEventListener('click', function(e) {
    var rect = track.getBoundingClientRect();
    var pct  = (e.clientX - rect.left) / rect.width;
    scPosition = pct * scDuration;
    updateProgress(scPosition, scDuration);
    if (scWidget) { try { scWidget.seekTo(scPosition); } catch(e2) {} }
  });
}

function togglePlaylist() {
  var drawer = $('sc-drawer');
  if (!drawer) return;
  scPlaylistOpen = !scPlaylistOpen;
  drawer.style.maxHeight = scPlaylistOpen ? '220px' : '0';
  drawer.style.opacity   = scPlaylistOpen ? '1' : '0';
  var btn = $('sc-playlist-btn');
  if (btn) btn.classList.toggle('active', scPlaylistOpen);
}

function renderSoundCloudPlayer(track) {
  scQueue.tracks  = track.queue || [track];
  scQueue.index   = 0;
  scQueue.shuffle = false;
  scQueue.repeat  = false;

  var first    = scQueue.tracks[0];
  var embedSrc = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(first.trackUrl) +
    '&color=%2300e5ff&auto_play=true&hide_related=true&show_comments=false&show_user=true&visual=true&buying=false&sharing=false&download=false';

  var queueHTML = scQueue.tracks.map(function(t, i) {
    return '<div class="sc-queue-item' + (i === 0 ? ' active' : '') + '" data-index="' + i + '">' +
      '<span class="sc-queue-num">' + (i + 1) + '</span>' +
      '<div class="sc-queue-info">' +
        '<div class="sc-queue-title">' + escapeHtml(t.title) + '</div>' +
        '<div class="sc-queue-author">' + escapeHtml(t.author) + '</div>' +
      '</div>' +
      '<span class="sc-queue-dur">' + escapeHtml(t.duration) + '</span>' +
    '</div>';
  }).join('');

  var div = document.createElement('div');
  div.className = 'message bot-message';
  div.style.opacity = '0';
  div.innerHTML =
    '<div class="msg-meta">' +
      '<span class="msg-source">TROY BOT</span>' +
      '<span class="msg-time">' + formatTime() + '</span>' +
    '</div>' +
    '<div class="player-card">' +
      '<div class="sc-iframe-wrap">' +
        '<iframe id="sc-iframe" src="' + embedSrc + '" frameborder="0" allow="autoplay" scrolling="no"></iframe>' +
      '</div>' +
      '<div class="sp-body">' +
        '<div class="sp-art" id="sc-art" ' + (first.thumbnail ? 'style="background-image:url(' + first.thumbnail + ')"' : '') + '></div>' +
        '<div class="sp-info">' +
          '<div class="sp-title" id="sc-title">' + escapeHtml(first.title) + '</div>' +
          '<div class="sp-artist" id="sc-author">' + escapeHtml(first.author) + '</div>' +
          '<div class="sp-platform">SoundCloud</div>' +
        '</div>' +
        '<button class="sp-playlist-btn" id="sc-playlist-btn" title="Playlist">&#9776;</button>' +
      '</div>' +
      '<div class="sp-progress">' +
        '<span class="sp-time" id="sc-pos">0:00</span>' +
        '<div class="sp-track" id="sc-progress-track"><div class="sp-fill" id="sc-progress-fill"></div></div>' +
        '<span class="sp-time" id="sc-dur">0:00</span>' +
      '</div>' +
      '<div class="sp-controls">' +
        '<button class="sp-ctrl sm" id="sc-shuffle" title="Shuffle">&#8700;</button>' +
        '<button class="sp-ctrl" id="sc-prev" title="Previous">&#9664;&#9664;</button>' +
        '<button class="sp-ctrl play-btn" id="sc-playpause" title="Pause">&#9646;&#9646;</button>' +
        '<button class="sp-ctrl" id="sc-next" title="Next">&#9654;&#9654;</button>' +
        '<button class="sp-ctrl sm" id="sc-repeat" title="Repeat">&#8635;</button>' +
        '<span class="sp-queue-pos" id="sc-queue-pos">1 / ' + scQueue.tracks.length + '</span>' +
      '</div>' +
      '<div class="sc-drawer" id="sc-drawer">' +
        '<div class="sc-drawer-header">PLAYLIST</div>' +
        '<div class="sc-queue-list">' + queueHTML + '</div>' +
      '</div>' +
    '</div>';

  chatMessages.appendChild(div);
  requestAnimationFrame(function() { div.style.opacity = '1'; div.style.transition = 'opacity 0.4s'; });
  localCount++;
  if (msgCountEl) msgCountEl.textContent = localCount;
  scrollToBottom();

  div.querySelector('#sc-prev').addEventListener('click', scPrev);
  div.querySelector('#sc-next').addEventListener('click', scNext);
  div.querySelector('#sc-playpause').addEventListener('click', function() {
    scPlaying = !scPlaying;
    this.innerHTML = scPlaying ? '&#9646;&#9646;' : '&#9654;';
    if (scWidget) { try { scWidget.toggle(); } catch(e) {} }
  });
  div.querySelector('#sc-shuffle').addEventListener('click', function() {
    scQueue.shuffle = !scQueue.shuffle;
    this.classList.toggle('active', scQueue.shuffle);
  });
  div.querySelector('#sc-repeat').addEventListener('click', function() {
    scQueue.repeat = !scQueue.repeat;
    this.classList.toggle('active', scQueue.repeat);
  });
  div.querySelector('#sc-playlist-btn').addEventListener('click', togglePlaylist);
  div.querySelectorAll('.sc-queue-item').forEach(function(el) {
    el.addEventListener('click', function() { scPlay(parseInt(el.dataset.index)); });
  });

  startProgressSim(first);
  initProgressClick();
  setTimeout(bindWidget, 1500);
}

/* ---- EVENT LISTENERS ---- */
commandForm.addEventListener('submit', function(e) {
  e.preventDefault();
  var val = commandInput.value.trim();
  if (!val) return;
  commandInput.value = '';
  sendCommand(val);
});

clearBtn.addEventListener('click', function() {
  chatMessages.innerHTML = '';
  seenIds = {}; localCount = 0;
  if (msgCountEl) msgCountEl.textContent = 0;
});

document.querySelectorAll('.quick-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    commandInput.value = btn.getAttribute('data-cmd') || '';
    commandInput.focus();
  });
});

/* ---- PARTICLES ---- */
(function() {
  var canvas = $('particles');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var W, H, particles = [];
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize);
  resize();
  for (var i = 0; i < 55; i++) {
    particles.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.5 + 0.3,
      a: Math.random() * 0.4 + 0.1,
      color: Math.random() > 0.5 ? '0,229,255' : '0,255,157',
    });
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(function(p) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + p.color + ',' + p.a + ')';
      ctx.fill();
    });
    for (var i = 0; i < particles.length; i++) {
      for (var j = i + 1; j < particles.length; j++) {
        var dx = particles[i].x - particles[j].x;
        var dy = particles[i].y - particles[j].y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = 'rgba(0,229,255,' + (0.06 * (1 - dist / 100)) + ')';
          ctx.lineWidth = 0.5; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ---- INIT ---- */
fetchStatus();
fetchMessages();
setInterval(fetchStatus, 30000);
