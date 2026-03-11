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

    if (data.trackInfo) {
      if (data.botEntry) renderMessage(data.botEntry);
      renderSoundCloudPlayer(data.trackInfo);
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


// ── Render SoundCloud player card ─────────────────────────
function renderSoundCloudPlayer(track) {
  const div = document.createElement('div');
  div.className = 'message bot-message';
  div.style.opacity = '0';

  // Build embed src — use the one from oEmbed or construct it
  let embedSrc = track.embedSrc;
  if (!embedSrc && track.trackUrl) {
    embedSrc = `https://w.soundcloud.com/player/?url=${encodeURIComponent(track.trackUrl)}&color=%2300d4ff&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=true`;
  }

  div.innerHTML = `
    <div class="msg-meta">
      <span class="msg-source">TROY BOT</span>
      <span class="msg-time">${formatTime()}</span>
    </div>
    <div class="player-card">
      <div class="player-screen sc-screen">
        <div class="player-corner tl"></div>
        <div class="player-corner tr"></div>
        <div class="player-corner bl"></div>
        <div class="player-corner br"></div>
        <iframe
          src="${embedSrc}"
          frameborder="0"
          allow="autoplay"
          scrolling="no"
          style="width:100%;height:100%;position:absolute;top:0;left:0;"
        ></iframe>
      </div>
      <div class="player-info-bar">
        <div class="player-eq-wrap">
          <div class="player-eq-bar"></div>
          <div class="player-eq-bar"></div>
          <div class="player-eq-bar"></div>
          <div class="player-eq-bar"></div>
          <div class="player-eq-bar"></div>
        </div>
        <div class="player-text">
          <div class="player-title">${escapeHtml(track.title)}</div>
          <div class="player-meta">
            <span>${escapeHtml(track.author)}</span>
            <span class="player-meta-dot">·</span>
            <span style="color:var(--troy)">SoundCloud</span>
          </div>
        </div>
        <span class="player-type-badge">🎵 AUDIO</span>
      </div>
    </div>
  `;

  chatMessages.appendChild(div);
  requestAnimationFrame(() => {
    div.style.opacity = '1';
    div.style.transition = 'opacity 0.4s ease';
  });
  localCount++;
  msgCountEl.textContent = localCount;
  scrollToBottom();
}

// Keep old function name as alias just in case
function renderPlayerCard(info) { renderSoundCloudPlayer(info); }
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