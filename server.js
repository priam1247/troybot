const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://w.soundcloud.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["https://w.soundcloud.com"],
    },
  },
}));

app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { error: 'Too many requests. Slow down, commander.' },
});
app.use('/api/', limiter);

const messageLog = [];
const MAX_LOG = 100;

function addToLog(source, content, type = 'info') {
  const entry = {
    id: Date.now() + Math.random().toString(36).slice(2),
    source, content, type,
    timestamp: new Date().toISOString(),
  };
  messageLog.unshift(entry);
  if (messageLog.length > MAX_LOG) messageLog.pop();
  return entry;
}

// ── SoundCloud client_id cache ────────────────────────────
let scClientId = null;
let scClientIdFetchedAt = 0;
const SC_CLIENT_ID_TTL = 1000 * 60 * 60; // 1 hour cache

async function getSCClientId() {
  const now = Date.now();
  if (scClientId && (now - scClientIdFetchedAt) < SC_CLIENT_ID_TTL) {
    return scClientId;
  }

  console.log('Fetching SoundCloud client_id...');
  try {
    // Fetch SoundCloud homepage
    const res = await fetch('https://soundcloud.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();

    // Find script URLs in the page
    const scriptUrls = [...html.matchAll(/crossorigin src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
    console.log(`Found ${scriptUrls.length} SC scripts`);

    // Search scripts for client_id
    for (const url of scriptUrls.slice(-5)) {
      try {
        const jsRes = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(8000),
        });
        const js = await jsRes.text();
        const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/);
        if (match) {
          scClientId = match[1];
          scClientIdFetchedAt = now;
          console.log('Got SC client_id:', scClientId.slice(0, 8) + '...');
          return scClientId;
        }
      } catch (e) {
        console.log('Script fetch failed:', e.message);
      }
    }
    throw new Error('client_id not found in any script');
  } catch (err) {
    console.error('getSCClientId failed:', err.message);
    throw err;
  }
}

// ── SoundCloud search using API ───────────────────────────
async function searchSoundCloud(query) {
  const clientId = await getSCClientId();
  const apiUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=5&offset=0`;

  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    // client_id might be expired, clear cache and throw
    scClientId = null;
    throw new Error(`SC API returned ${res.status}`);
  }

  const data = await res.json();
  if (!data.collection || data.collection.length === 0) {
    throw new Error('No tracks found');
  }

  const track = data.collection[0];
  return {
    title: track.title,
    author: track.user?.username || 'Unknown',
    trackUrl: track.permalink_url,
    thumbnail: track.artwork_url || track.user?.avatar_url || '',
    duration: track.duration ? formatDuration(track.duration) : '',
    embedSrc: `https://w.soundcloud.com/player/?url=${encodeURIComponent(track.permalink_url)}&color=%2300d4ff&auto_play=true&hide_related=true&show_comments=false&show_user=true&visual=true`,
  };
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Status ─────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ online: true, botName: 'Troy Bot', uptime: process.uptime(), timestamp: new Date().toISOString(), messageCount: messageLog.length });
});

// ── Messages ───────────────────────────────────────────────
app.get('/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  res.json({ messages: messageLog.slice(0, limit) });
});

// ── Main command handler ───────────────────────────────────
app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string')
    return res.status(400).json({ error: 'Missing or invalid command.' });

  const trimmed = command.trim().slice(0, 300);
  const userEntry = addToLog('web', trimmed, 'command');
  const cmd = trimmed.toLowerCase();

  // ── .song ────────────────────────────────────────────────
  if (cmd.startsWith('.song ')) {
    const query = trimmed.slice(6).trim();
    if (!query) return res.json({ userEntry, botEntry: addToLog('troy-bot', '❌ Usage: .song [song name]', 'response') });

    try {
      console.log(`Searching SoundCloud: "${query}"`);
      const track = await searchSoundCloud(query);
      const botEntry = addToLog('troy-bot', `🎵 Now streaming: ${track.title} by ${track.author}`, 'player');
      return res.json({ userEntry, botEntry, trackInfo: track });
    } catch (err) {
      console.error('Song error:', err.message);
      return res.json({ userEntry, botEntry: addToLog('troy-bot', `❌ Could not find "${query}" on SoundCloud. Try: .song westlife flying without wings`, 'error') });
    }
  }

  // ── Other commands ────────────────────────────────────────
  let botReply = null;
  try { botReply = await forwardToDiscordBot(trimmed); } catch (err) {
    console.error('Discord bot unreachable:', err.message);
  }
  res.json({ userEntry, botEntry: addToLog('troy-bot', botReply?.reply || autoReply(trimmed), 'response') });
});

// ── Discord webhook ────────────────────────────────────────
app.post('/api/discord-webhook', (req, res) => {
  const secret = req.headers['x-troy-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized.' });
  const { source, content, type } = req.body;
  if (!content) return res.status(400).json({ error: 'Missing content.' });
  res.json({ ok: true, entry: addToLog(source || 'discord', content, type || 'discord') });
});

async function forwardToDiscordBot(command) {
  const BOT_URL = process.env.KATAMUMP_BOT_URL;
  const BOT_SECRET = process.env.BOT_API_SECRET;
  if (!BOT_URL) throw new Error('KATAMUMP_BOT_URL not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${BOT_URL}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-troy-secret': BOT_SECRET || '' },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Bot responded ${response.status}`);
    return await response.json();
  } catch (err) { clearTimeout(timeout); throw err; }
}

function autoReply(command) {
  const cmd = command.toLowerCase();
  if (cmd.startsWith('/help'))    return '📖 Commands: /help, /ping, /status\n🎵 Music: .song [name]';
  if (cmd.startsWith('/ping'))    return '🏓 Pong! Troy Bot is online and listening.';
  if (cmd.startsWith('/status'))  return `⚙️ Server uptime: ${Math.floor(process.uptime())}s. All systems nominal.`;
  if (cmd.startsWith('/say '))    return `📣 Echoing: "${command.slice(5)}"`;
  if (cmd.startsWith('/discord')) return '🔗 Discord invite: discord.gg/your-invite-here';
  return `✅ Command received: "${command}". Try .song [name] to stream music!`;
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`🤖 Troy Bot running on port ${PORT}`));