/* ── TROY BOT — Frontend App ───────────────────────────── */

const $ = id => document.getElementById(id);

// ── DOM refs ──────────────────────────────────────────────
const chatMessages = $('chatMessages');
const commandForm  = $('commandForm');
const commandInput = $('commandInput');
const sendBtn      = $('sendBtn');
const clearBtn     = $('clearBtn');
const statusPill   = $('statusPill');
const statusDot    = $('statusDot');
const statusText   = $('statusText');
const uptimeVal    = $('uptimeVal');
const msgCountEl   = $('msgCount');
const botAvatar    = $('botAvatar');

// ── State ─────────────────────────────────────────────────
let seenIds     = new Set();
let pollTimer   = null;
let isOnline    = false;
let localCount  = 0;

// ── Helpers ───────────────────────────────────────────────
function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatUptime(secs) {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Render a message bubble ────────────────────────────────
function renderMessage({ id, source, content, type, timestamp }) {
  if (id && seenIds.has(id)) return;
  if (id) seenIds.add(id);

  const div = document.createElement('div');

  let cssClass = 'bot-message';
  let label    = 'TROY BOT';
  if (source === 'web')     { cssClass = 'user-message';    label = 'YOU'; }
  if (source === 'discord') { cssClass = 'discord-message'; label = 'DISCORD'; }
  if (type === 'error')     { cssClass = 'error-message';   label = 'ERROR'; }

  div.className = `message ${cssClass}`;
  div.innerHTML = `
    <div class="msg-meta">
      <span class="msg-source">${label}</span>
      <span class="msg-time">${formatTime(timestamp)}</span>
    </div>
    <div class="msg-content">${escapeHtml(content)}</div>
  `;

  chatMessages.appendChild(div);
  localCount++;
  msgCountEl.textContent = localCount;
  scrollToBottom();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Typing indicator ──────────────────────────────────────
function showTyping() {
  removeTyping();
  const div = document.createElement('div');
  div.className = 'message bot-message typing-indicator';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="msg-meta">
      <span class="msg-source">TROY BOT</span>
      <span class="msg-time">typing…</span>
    </div>
    <div class="msg-content">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;
  chatMessages.appendChild(div);
  scrollToBottom();
}
function removeTyping() {
  const el = $('typingIndicator');
  if (el) el.remove();
}

// ── Status update ──────────────────────────────────────────
function setStatus(online, text) {
  isOnline = online;
  statusPill.className = 'status-pill ' + (online ? 'online' : 'offline');
  statusText.textContent = text;
}

// ── Fetch server status ────────────────────────────────────
async function fetchStatus() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    setStatus(true, 'ONLINE');
    uptimeVal.textContent = formatUptime(data.uptime);
    botAvatar.style.filter = 'drop-shadow(0 0 12px rgba(0,255,136,0.6))';
  } catch {
    setStatus(false, 'OFFLINE');
    botAvatar.style.filter = 'drop-shadow(0 0 8px rgba(255,107,53,0.5))';
  }
}

// ── Poll for new Discord messages ─────────────────────────
async function pollMessages() {
  try {
    const res  = await fetch('/api/messages?limit=20');
    const data = await res.json();
    const msgs = (data.messages || []).reverse(); // oldest first
    msgs.forEach(renderMessage);
  } catch {
    // silent
  }
}

// ── Send a command ─────────────────────────────────────────
async function sendCommand(command) {
  if (!command.trim()) return;

  sendBtn.disabled = true;
  commandInput.disabled = true;

  // Optimistic user bubble
  renderMessage({ source: 'web', content: command, timestamp: new Date().toISOString() });
  showTyping();

  try {
    const res  = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();

    removeTyping();

    if (data.videoInfo) {
      if (data.botEntry) renderMessage(data.botEntry);
      renderPlayerCard(data.videoInfo);
    } else if (data.botEntry) {
      renderMessage(data.botEntry);
    } else if (!res.ok) {
      renderMessage({ source: 'error', content: data.error || 'Unknown error', type: 'error', timestamp: new Date().toISOString() });
    }
  } catch {
    removeTyping();
    renderMessage({ source: 'error', content: 'Network error — could not reach server.', type: 'error', timestamp: new Date().toISOString() });
  }

  sendBtn.disabled = false;
  commandInput.disabled = false;
  commandInput.focus();
}

// ── Cobalt download (browser calls cobalt directly — no Railway!) ──
async function cobaltDownload(videoId, audioOnly, btnEl) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const originalText = btnEl.textContent;
  btnEl.textContent = '⏳ Getting link…';
  btnEl.disabled = true;

  // Cobalt v10 API — called directly from the browser
  const COBALT_API = 'https://api.cobalt.tools/';

  try {
    const res = await fetch(COBALT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        url: ytUrl,
        downloadMode: audioOnly ? 'audio' : 'auto',
        audioFormat: 'mp3',
        filenameStyle: 'basic',
        videoQuality: '720',
      }),
    });

    if (!res.ok) throw new Error(`Cobalt API error: ${res.status}`);
    const data = await res.json();
    console.log('Cobalt response:', data);

    // Handle different response statuses
    if (data.status === 'tunnel' || data.status === 'redirect') {
      triggerDownload(data.url);
      btnEl.textContent = '✅ Starting download…';
      setTimeout(() => { btnEl.textContent = originalText; btnEl.disabled = false; }, 4000);

    } else if (data.status === 'picker') {
      // Multiple streams — pick the best one
      const best = data.picker?.find(p => p.type === 'audio') || data.picker?.[0];
      if (best?.url) {
        triggerDownload(best.url);
        btnEl.textContent = '✅ Starting download…';
        setTimeout(() => { btnEl.textContent = originalText; btnEl.disabled = false; }, 4000);
      } else {
        throw new Error('No download stream found');
      }

    } else if (data.status === 'error') {
      throw new Error(data.error?.code || 'Cobalt error');

    } else {
      // Fallback — open cobalt web interface for this video
      window.open(`https://cobalt.tools/#${encodeURIComponent(ytUrl)}`, '_blank');
      btnEl.textContent = '↗ Opened Cobalt';
      setTimeout(() => { btnEl.textContent = originalText; btnEl.disabled = false; }, 3000);
    }

  } catch (err) {
    console.error('Cobalt error:', err.message);
    // Fallback — open cobalt.tools website directly
    window.open(`https://cobalt.tools/#${encodeURIComponent(ytUrl)}`, '_blank');
    btnEl.textContent = '↗ Opened cobalt.tools';
    setTimeout(() => { btnEl.textContent = originalText; btnEl.disabled = false; }, 3000);
  }
}

function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
// ── Render YouTube player card ─────────────────────────────
function renderPlayerCard(info) {
  const videoId = info.videoId || '';
  const div = document.createElement('div');
  div.className = 'message bot-message';
  div.style.opacity = '0';
  div.innerHTML = `
    <div class="msg-meta">
      <span class="msg-source">TROY BOT</span>
      <span class="msg-time">${formatTime()}</span>
    </div>
    <div class="player-card">
      <div class="player-title">${escapeHtml(info.title)}</div>
      <div class="player-meta">${escapeHtml(info.author)} · ${escapeHtml(info.duration)}</div>
      <div class="player-embed">
        <iframe
          src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1"
          frameborder="0"
          allow="autoplay; encrypted-media; fullscreen"
          allowfullscreen
        ></iframe>
      </div>
      <div class="player-actions">
        <button class="dl-btn" id="mp3-${videoId}">🎵 Download MP3</button>
        <button class="dl-btn dl-btn-video" id="mp4-${videoId}">🎬 Download MP4</button>
        <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" class="dl-btn dl-btn-alt">▶ YouTube</a>
        <a href="https://cobalt.tools/#${encodeURIComponent('https://www.youtube.com/watch?v=${videoId}')}" target="_blank" class="dl-btn dl-btn-alt">🔗 cobalt.tools</a>
      </div>
      <div class="player-cobalt-note">⚡ Downloads powered by <strong>cobalt.tools</strong> — runs in your browser, not the server</div>
    </div>
  `;
  chatMessages.appendChild(div);
  requestAnimationFrame(() => { div.style.opacity = '1'; div.style.transition = 'opacity 0.3s'; });
  localCount++;
  msgCountEl.textContent = localCount;
  scrollToBottom();

  // Wire up download buttons — browser calls cobalt directly, Railway not involved!
  div.querySelector(`#mp3-${videoId}`).addEventListener('click', function() {
    cobaltDownload(videoId, true, this);
  });
  div.querySelector(`#mp4-${videoId}`).addEventListener('click', function() {
    cobaltDownload(videoId, false, this);
  });
}

// ── Event listeners ────────────────────────────────────────
commandForm.addEventListener('submit', e => {
  e.preventDefault();
  const val = commandInput.value.trim();
  if (!val) return;
  commandInput.value = '';
  sendCommand(val);
});

clearBtn.addEventListener('click', () => {
  chatMessages.innerHTML = '';
  seenIds.clear();
  localCount = 0;
  msgCountEl.textContent = '0';
});

// Quick command buttons
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    commandInput.value = cmd;
    commandInput.focus();
  });
});

// Enter key hint
commandInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    // form submit handles this
  }
});

// ── Init ───────────────────────────────────────────────────
(async function init() {
  await fetchStatus();
  await pollMessages();

  // Poll for status every 15s, messages every 5s
  setInterval(fetchStatus, 15_000);
  setInterval(pollMessages, 5_000);
})();