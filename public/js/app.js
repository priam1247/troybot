/* =============================================================
   TROYBOT — Frontend v4.0  (Local Music Only)
   ============================================================= */
'use strict';

/* ---- DOM ---- */
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

/* ---- LOCAL LIBRARY ---- */
var localLibrary = []; // array of { file, title, artist }

/* ---- HELPERS ---- */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function now() { return new Date().toLocaleTimeString(); }
function formatUptime(s) {
  s = parseInt(s) || 0;
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm ' + sec + 's';
  return sec + 's';
}
function formatMs(ms) {
  if (!ms || isNaN(ms) || !isFinite(ms) || ms < 0) return '0:00';
  var s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}
function scrollBot() { chatMessages.scrollTop = chatMessages.scrollHeight; }
function bump() { localCount++; if (msgCountEl) msgCountEl.textContent = localCount; }

/* ---- STATUS ---- */
function fetchStatus() {
  fetch('/api/status')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (statusDot)   statusDot.className    = 'status-dot online';
      if (statusLabel) statusLabel.textContent = 'ONLINE';
      if (uptimeVal)   uptimeVal.textContent   = formatUptime(d.uptime);
    })
    .catch(function() {
      if (statusDot)   statusDot.className    = 'status-dot offline';
      if (statusLabel) statusLabel.textContent = 'OFFLINE';
    });
}

/* ---- LOAD MESSAGES ---- */
function fetchMessages() {
  fetch('/api/messages?limit=20')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      (d.messages || []).reverse().forEach(function(m) {
        if (!seenIds[m.id]) { seenIds[m.id] = true; appendMessage(m); }
      });
      scrollBot();
    }).catch(function() {});
}

/* ---- RENDER MESSAGE ---- */
function appendMessage(msg) {
  var isUser  = msg.source === 'web';
  var isError = msg.type   === 'error';
  var cls = isUser ? 'user-message' : isError ? 'error-message' : 'bot-message';
  var who = isUser ? 'YOU' : isError ? 'ERROR' : 'TROY BOT';
  var div = document.createElement('div');
  div.className    = 'message ' + cls;
  div.style.opacity = '0';
  div.innerHTML =
    '<div class="msg-meta"><span class="msg-source">' + who + '</span>' +
    '<span class="msg-time">' + now() + '</span></div>' +
    '<div class="msg-content">' + escapeHtml(msg.content || '') + '</div>';
  chatMessages.appendChild(div);
  requestAnimationFrame(function() { div.style.opacity = '1'; div.style.transition = 'opacity 0.3s'; });
  bump(); scrollBot();
}

function showTyping() {
  var d = document.createElement('div');
  d.id = 'typing'; d.className = 'message bot-message typing-indicator';
  d.innerHTML = '<span></span><span></span><span></span>';
  chatMessages.appendChild(d); scrollBot();
}
function hideTyping() { var t = $('typing'); if (t) t.remove(); }

/* ---- SEND COMMAND (server commands only) ---- */
function sendCommand(command) {
  sendBtn.disabled = commandInput.disabled = true;
  appendMessage({ source: 'web', content: command });
  showTyping();
  fetch('/api/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: command }),
  })
  .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
  .then(function(r) {
    hideTyping();
    var d = r.data;
    if (d.cleared) {
      chatMessages.innerHTML = ''; seenIds = {}; localCount = 0;
      if (msgCountEl) msgCountEl.textContent = '0';
      appendMessage({ source: 'troy-bot', content: 'Chat cleared!' });
    } else if (d.botEntry) {
      appendMessage(d.botEntry);
    } else if (!r.ok) {
      appendMessage({ source: 'error', type: 'error', content: d.error || 'Server error' });
    }
  })
  .catch(function(e) {
    hideTyping();
    appendMessage({ source: 'error', type: 'error', content: 'Request failed: ' + e.message });
  })
  .finally(function() {
    sendBtn.disabled = commandInput.disabled = false;
    commandInput.focus();
  });
}

/* =============================================================
   LOCAL MUSIC LIBRARY
   ============================================================= */
function parseFileInfo(file) {
  var clean  = file.name.replace(/\.[^.]+$/, '').trim();
  var parts  = clean.split(/\s*-\s*/);
  return {
    file:   file,
    name:   clean.toLowerCase(),
    title:  parts.length > 1 ? parts.slice(1).join(' - ').trim() : clean,
    artist: parts.length > 1 ? parts[0].trim() : 'Unknown',
  };
}

function loadMusicFolder() {
  /* Try File System Access API (Chrome/Edge desktop) */
  if (window.showDirectoryPicker) {
    window.showDirectoryPicker({ mode: 'read' })
      .then(async function(dirHandle) {
        var files = [];
        for await (var entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            var f = await entry.getFile();
            if (f.type.startsWith('audio/') || /\.(mp3|flac|wav|m4a|ogg|aac|wma|opus)$/i.test(f.name)) {
              files.push(parseFileInfo(f));
            }
          }
        }
        if (!files.length) {
          appendMessage({ source: 'troy-bot', content: 'No audio files found in that folder. Make sure it contains MP3, FLAC, WAV etc.' });
          return;
        }
        localLibrary = files;
        appendMessage({ source: 'troy-bot', content: '📂 Loaded ' + files.length + ' songs! Now type .song [name] to search and play.' });
      })
      .catch(function(e) {
        if (e.name === 'AbortError') return; /* user cancelled */
        /* Fallback to multi-file picker */
        fallbackFilePicker();
      });
  } else {
    fallbackFilePicker();
  }
}

function fallbackFilePicker() {
  var input = document.createElement('input');
  input.type     = 'file';
  input.accept   = 'audio/*';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', function() {
    var files = Array.from(input.files || []);
    input.remove();
    if (!files.length) return;
    localLibrary = files.map(parseFileInfo);
    appendMessage({ source: 'troy-bot', content: '📂 Loaded ' + localLibrary.length + ' songs! Now type .song [name] to search and play.' });
  });
  input.click();
}

function searchLocalLibrary(query) {
  if (!localLibrary.length) {
    appendMessage({ source: 'troy-bot', content: 'No music loaded yet! Click 💾 first to load your music folder, then try .song again.' });
    return;
  }
  var q = query.toLowerCase().trim();
  var results = localLibrary.filter(function(t) {
    return t.name.includes(q) || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
  });
  if (!results.length) {
    appendMessage({ source: 'troy-bot', content: 'No songs matching "' + query + '" in your library. Try a different name.' });
    return;
  }
  appendMessage({ source: 'troy-bot', content: '🎵 Found ' + results.length + ' match' + (results.length !== 1 ? 'es' : '') + ' for "' + query + '"' });
  renderLocalPlayer(results.map(function(r) { return r.file; }));
}

/* =============================================================
   LOCAL FILE PLAYER
   ============================================================= */
function renderLocalPlayer(files) {
  if (!files || !files.length) return;
  var state  = { index: 0, shuffle: false, repeat: false, open: false };

  var tracks = files.map(function(f) {
    var clean  = f.name.replace(/\.[^.]+$/, '').trim();
    var parts  = clean.split(/\s*-\s*/);
    return {
      url:    URL.createObjectURL(f),
      title:  parts.length > 1 ? parts.slice(1).join(' - ').trim() : clean,
      artist: parts.length > 1 ? parts[0].trim() : 'Local File',
    };
  });
  var first = tracks[0];

  var qHTML = tracks.map(function(t, i) {
    return (
      '<div class="sc-queue-item' + (i === 0 ? ' active' : '') + '" data-qi="' + i + '">' +
        '<span class="sc-queue-num">' + (i + 1) + '</span>' +
        '<div class="sc-queue-info">' +
          '<div class="sc-queue-title">'  + escapeHtml(t.title)  + '</div>' +
          '<div class="sc-queue-author">' + escapeHtml(t.artist) + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  var card = document.createElement('div');
  card.className    = 'message bot-message';
  card.style.opacity = '0';
  card.innerHTML =
    '<div class="msg-meta"><span class="msg-source">TROY BOT</span>' +
    '<span class="msg-time">' + now() + '</span></div>' +
    '<div class="player-card">' +
      '<audio id="loc-audio" preload="auto" style="display:none"></audio>' +
      '<div class="sp-body">' +
        '<div class="sp-art local-art">&#9835;</div>' +
        '<div class="sp-info">' +
          '<div class="sp-title"  id="loc-title">'  + escapeHtml(first.title)  + '</div>' +
          '<div class="sp-artist" id="loc-artist">' + escapeHtml(first.artist) + '</div>' +
          '<div class="sp-platform local-badge">&#128192; Local File</div>' +
        '</div>' +
        '<button class="sp-ctrl sm lyrics-btn" id="loc-lyr" title="Lyrics">&#9836; Lyrics</button>' +
        '<button class="sp-playlist-btn" id="loc-qbtn" title="Queue">&#9776;</button>' +
      '</div>' +
      '<div class="sp-progress">' +
        '<span class="sp-time" id="loc-pos">0:00</span>' +
        '<div class="sp-track" id="loc-bar"><div class="sp-fill" id="loc-fill"></div></div>' +
        '<span class="sp-time" id="loc-dur">0:00</span>' +
      '</div>' +
      '<div class="sp-controls">' +
        '<button class="sp-ctrl sm"       id="loc-shuf"   title="Shuffle">&#8700;</button>' +
        '<button class="sp-ctrl"          id="loc-prev"   title="Prev">&#9664;&#9664;</button>' +
        '<button class="sp-ctrl play-btn" id="loc-pp"     title="Play">&#9654;</button>' +
        '<button class="sp-ctrl"          id="loc-next"   title="Next">&#9654;&#9654;</button>' +
        '<button class="sp-ctrl sm"       id="loc-rep"    title="Repeat">&#8635;</button>' +
        '<span  class="sp-queue-pos"      id="loc-qpos">1 / ' + tracks.length + '</span>' +
      '</div>' +
      '<div class="sc-drawer" id="loc-drawer">' +
        '<div class="sc-drawer-header">QUEUE (' + tracks.length + ' songs)</div>' +
        '<div class="sc-queue-list">' + qHTML + '</div>' +
      '</div>' +
      '<div class="lyrics-box" id="loc-lyrics" style="display:none"></div>' +
    '</div>';

  chatMessages.appendChild(card);
  requestAnimationFrame(function() { card.style.opacity = '1'; card.style.transition = 'opacity 0.4s'; });
  bump(); scrollBot();

  var audio  = card.querySelector('#loc-audio');
  var fill   = card.querySelector('#loc-fill');
  var posEl  = card.querySelector('#loc-pos');
  var durEl  = card.querySelector('#loc-dur');
  var ppBtn  = card.querySelector('#loc-pp');
  var bar    = card.querySelector('#loc-bar');
  var drawer = card.querySelector('#loc-drawer');
  var qpos   = card.querySelector('#loc-qpos');

  function play(idx) {
    if (idx < 0)              idx = tracks.length - 1;
    if (idx >= tracks.length) idx = 0;
    state.index = idx;
    var t = tracks[idx];
    audio.src = t.url;
    audio.load();
    audio.play().then(function() { ppBtn.innerHTML = '&#9646;&#9646;'; }).catch(function() {});
    card.querySelector('#loc-title').textContent  = t.title;
    card.querySelector('#loc-artist').textContent = t.artist;
    if (qpos) qpos.textContent = (idx + 1) + ' / ' + tracks.length;
    card.querySelectorAll('.sc-queue-item').forEach(function(el, i) {
      el.classList.toggle('active', i === idx);
    });
  }

  audio.addEventListener('timeupdate', function() {
    if (!audio.duration || isNaN(audio.duration)) return;
    fill.style.width = ((audio.currentTime / audio.duration) * 100) + '%';
    if (posEl) posEl.textContent = formatMs(audio.currentTime * 1000);
    if (durEl) durEl.textContent = formatMs(audio.duration * 1000);
  });
  audio.addEventListener('ended', function() {
    if (state.repeat)       { audio.currentTime = 0; audio.play(); }
    else if (state.shuffle) { play(Math.floor(Math.random() * tracks.length)); }
    else                    { play(state.index + 1); }
  });
  bar.addEventListener('click', function(e) {
    if (!audio.duration) return;
    var r = bar.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  ppBtn.addEventListener('click', function() {
    if (audio.paused) { audio.play(); ppBtn.innerHTML = '&#9646;&#9646;'; }
    else              { audio.pause(); ppBtn.innerHTML = '&#9654;'; }
  });
  card.querySelector('#loc-prev').addEventListener('click', function() { play(state.index - 1); });
  card.querySelector('#loc-next').addEventListener('click', function() {
    if (state.shuffle) play(Math.floor(Math.random() * tracks.length));
    else               play(state.index + 1);
  });
  card.querySelector('#loc-shuf').addEventListener('click', function() {
    state.shuffle = !state.shuffle; this.classList.toggle('active', state.shuffle);
  });
  card.querySelector('#loc-rep').addEventListener('click', function() {
    state.repeat = !state.repeat; this.classList.toggle('active', state.repeat);
  });
  card.querySelector('#loc-qbtn').addEventListener('click', function() {
    state.open = !state.open;
    drawer.style.maxHeight = state.open ? '220px' : '0';
    drawer.style.opacity   = state.open ? '1' : '0';
    this.classList.toggle('active', state.open);
  });
  card.querySelectorAll('.sc-queue-item').forEach(function(el) {
    el.addEventListener('click', function() { play(parseInt(el.getAttribute('data-qi'))); });
  });
  card.querySelector('#loc-lyr').addEventListener('click', function() {
    var t = tracks[state.index];
    fetchLyrics(t.artist, t.title, card.querySelector('#loc-lyrics'));
  });

  play(0);
}

/* =============================================================
   LYRICS via lyrics.ovh
   ============================================================= */
function fetchLyrics(artist, title, box) {
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';
  fetch('https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.lyrics) {
        box.innerHTML =
          '<div class="lyrics-header">&#9836; LYRICS</div>' +
          '<div class="lyrics-text">' + escapeHtml(d.lyrics).replace(/\n/g, '<br>') + '</div>';
      } else {
        box.innerHTML = '<div class="lyrics-none">No lyrics found.</div>';
      }
    })
    .catch(function() { box.innerHTML = '<div class="lyrics-none">Could not load lyrics.</div>'; });
}

/* =============================================================
   EVENT LISTENERS
   ============================================================= */
commandForm.addEventListener('submit', function(e) {
  e.preventDefault();
  var val = commandInput.value.trim();
  if (!val) return;

  /* .local or .load — open file picker */
  if (val.toLowerCase() === '.local' || val.toLowerCase() === '.load') {
    commandInput.value = '';
    loadMusicFolder();
    return;
  }

  /* .song — search local library */
  if (val.toLowerCase().startsWith('.song ')) {
    var q = val.slice(6).trim();
    if (q) {
      commandInput.value = '';
      appendMessage({ source: 'web', content: val });
      searchLocalLibrary(q);
      return;
    }
  }

  /* everything else — send to server */
  commandInput.value = '';
  sendCommand(val);
});

var loadMusicBtn = $('loadMusicBtn');
if (loadMusicBtn) loadMusicBtn.addEventListener('click', function() { loadMusicFolder(); });

clearBtn.addEventListener('click', function() {
  chatMessages.innerHTML = '';
  seenIds = {}; localCount = 0;
  if (msgCountEl) msgCountEl.textContent = '0';
});

document.querySelectorAll('.quick-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    commandInput.value = btn.getAttribute('data-cmd') || '';
    commandInput.focus();
  });
});

/* =============================================================
   PARTICLES
   ============================================================= */
(function() {
  var canvas = $('particles');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, pts = [];
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();
  for (var i = 0; i < 55; i++) {
    pts.push({ x: Math.random()*W, y: Math.random()*H,
      vx: (Math.random()-0.5)*0.4, vy: (Math.random()-0.5)*0.4,
      r: Math.random()*1.5+0.3, a: Math.random()*0.4+0.1,
      c: Math.random() > 0.5 ? '0,229,255' : '0,255,157' });
  }
  function draw() {
    ctx.clearRect(0,0,W,H);
    pts.forEach(function(p) {
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W; else if(p.x>W)p.x=0;
      if(p.y<0)p.y=H; else if(p.y>H)p.y=0;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle='rgba('+p.c+','+p.a+')'; ctx.fill();
    });
    for(var i=0;i<pts.length;i++) for(var j=i+1;j<pts.length;j++) {
      var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
      if(d<100){ ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
        ctx.strokeStyle='rgba(0,229,255,'+(0.06*(1-d/100))+')'; ctx.lineWidth=0.5; ctx.stroke(); }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

/* =============================================================
   INIT
   ============================================================= */
fetchStatus();
fetchMessages();
setInterval(fetchStatus, 30000);
