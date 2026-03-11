const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const yts = require('yt-search');
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
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
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

async function cobaltFetch(videoId, audioOnly) {
  const res = await fetch('https://cobalt.imput.net/api/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      vCodec: 'h264',
      vQuality: '720',
      aFormat: 'mp3',
      isAudioOnly: audioOnly,
      filenamePattern: 'basic',
    }),
  });
  if (!res.ok) throw new Error(`Cobalt API error ${res.status}`);
  return res.json();
}

app.get('/api/status', (req, res) => {
  res.json({ online: true, botName: 'Troy Bot', uptime: process.uptime(), timestamp: new Date().toISOString(), messageCount: messageLog.length });
});

app.get('/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  res.json({ messages: messageLog.slice(0, limit) });
});

app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') return res.status(400).json({ error: 'Missing or invalid command.' });

  const trimmed = command.trim().slice(0, 300);
  const userEntry = addToLog('web', trimmed, 'command');
  const cmd = trimmed.toLowerCase();

  if (cmd.startsWith('.song ') || cmd.startsWith('.video ')) {
    const isVideo = cmd.startsWith('.video ');
    const query = trimmed.slice(isVideo ? 7 : 6).trim();
    try {
      const results = await yts(query);
      const video = results.videos[0];
      if (!video) {
        return res.json({ userEntry, botEntry: addToLog('troy-bot', `❌ No results found for "${query}"`, 'response') });
      }
      const type = isVideo ? 'video' : 'song';
      const downloadUrl = `/api/download/${type}?id=${video.videoId}&title=${encodeURIComponent(video.title)}`;
      const botEntry = addToLog('troy-bot', `🎵 Found: ${video.title} (${video.timestamp}) by ${video.author.name}`, 'download');
      return res.json({
        userEntry, botEntry, downloadUrl,
        videoInfo: { title: video.title, duration: video.timestamp, author: video.author.name, thumbnail: video.thumbnail, videoId: video.videoId }
      });
    } catch (err) {
      return res.json({ userEntry, botEntry: addToLog('troy-bot', `❌ Search failed: ${err.message}`, 'error') });
    }
  }

  let botReply = null;
  try { botReply = await forwardToDiscordBot(trimmed); } catch (err) { console.error('Discord bot unreachable:', err.message); }

  const replyContent = botReply?.reply || autoReply(trimmed);
  res.json({ userEntry, botEntry: addToLog('troy-bot', replyContent, 'response') });
});

app.get('/api/download/song', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing video ID' });
  try {
    console.log(`Song download request: ${id}`);
    const data = await cobaltFetch(id, true);
    console.log('Cobalt response:', JSON.stringify(data));
    const url = data.url || data.audio;
    if (!url) throw new Error('No URL in response: ' + JSON.stringify(data));
    res.redirect(url);
  } catch (err) {
    console.error('Song error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download/video', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing video ID' });
  try {
    console.log(`Video download request: ${id}`);
    const data = await cobaltFetch(id, false);
    console.log('Cobalt response:', JSON.stringify(data));
    const url = data.url || data.picker?.[0]?.url;
    if (!url) throw new Error('No URL in response: ' + JSON.stringify(data));
    res.redirect(url);
  } catch (err) {
    console.error('Video error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try {
    const results = await yts(query);
    res.json({ videos: results.videos.slice(0, 5).map(v => ({ title: v.title, url: v.url, videoId: v.videoId, duration: v.timestamp, views: v.views, thumbnail: v.thumbnail, author: v.author.name })) });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

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
  if (cmd.startsWith('/help'))    return '📖 Commands: /help, /ping, /status, /say [msg], /discord\n🎵 Media: .song [name], .video [name]';
  if (cmd.startsWith('/ping'))    return '🏓 Pong! Troy Bot is online and listening.';
  if (cmd.startsWith('/status'))  return `⚙️ Server uptime: ${Math.floor(process.uptime())}s. All systems nominal.`;
  if (cmd.startsWith('/say '))    return `📣 Echoing to Discord: "${command.slice(5)}"`;
  if (cmd.startsWith('/discord')) return '🔗 Discord invite: discord.gg/your-invite-here';
  return `✅ Command received: "${command}". (Bot offline — running in local mode)`;
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🤖 Troy Bot server running on port ${PORT}`));
