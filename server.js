const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const yts = require('yt-search');
const YTDlpWrap = require('yt-dlp-wrap').default;
require('dotenv').config();

// Point to yt-dlp.exe in the project folder
const ytDlp = new YTDlpWrap(path.join(__dirname, 'yt-dlp.exe'));

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
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

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Slow down, commander.' },
});
app.use('/api/', limiter);

// In-memory message log (replace with DB in prod)
const messageLog = [];
const MAX_LOG = 100;

function addToLog(source, content, type = 'info') {
  const entry = {
    id: Date.now() + Math.random().toString(36).slice(2),
    source,
    content,
    type,
    timestamp: new Date().toISOString(),
  };
  messageLog.unshift(entry);
  if (messageLog.length > MAX_LOG) messageLog.pop();
  return entry;
}

// ── API Routes ──────────────────────────────────────────────

// GET /api/status — health check
app.get('/api/status', (req, res) => {
  res.json({
    online: true,
    botName: 'Troy Bot',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    messageCount: messageLog.length,
  });
});

// GET /api/messages — recent message log
app.get('/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  res.json({ messages: messageLog.slice(0, limit) });
});

// POST /api/command — user sends a command from the website
app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid command.' });
  }

  const trimmed = command.trim().slice(0, 300);
  const userEntry = addToLog('web', trimmed, 'command');
  const cmd = trimmed.toLowerCase();

  // ── Handle .song and .video locally ──────────────────────
  if (cmd.startsWith('.song ') || cmd.startsWith('.video ')) {
    const isVideo = cmd.startsWith('.video ');
    const query = trimmed.slice(isVideo ? 7 : 6).trim();
    try {
      const results = await yts(query);
      const video = results.videos[0];
      if (!video) {
        const botEntry = addToLog('troy-bot', `❌ No results found for "${query}"`, 'response');
        return res.json({ userEntry, botEntry });
      }
      const type = isVideo ? 'video' : 'song';
      const downloadUrl = `/api/download/${type}?q=${encodeURIComponent(query)}`;
      const replyContent = `🎵 Found: **${video.title}** (${video.timestamp}) by ${video.author.name}\n⬇️ [Click to download ${type}](${downloadUrl})`;
      const botEntry = addToLog('troy-bot', replyContent, 'download');
      return res.json({ userEntry, botEntry, downloadUrl, videoInfo: { title: video.title, duration: video.timestamp, author: video.author.name, thumbnail: video.thumbnail } });
    } catch (err) {
      const botEntry = addToLog('troy-bot', `❌ Search failed: ${err.message}`, 'error');
      return res.json({ userEntry, botEntry });
    }
  }

  // Forward command to Discord bot (Katamump)
  let botReply = null;
  try {
    botReply = await forwardToDiscordBot(trimmed);
  } catch (err) {
    console.error('Discord bot unreachable:', err.message);
  }

  const replyContent = botReply?.reply || autoReply(trimmed);
  const botEntry = addToLog('troy-bot', replyContent, 'response');

  res.json({ userEntry, botEntry });
});

// GET /api/download/song?q=westlife — download as MP3 via yt-dlp
app.get('/api/download/song', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  try {
    const results = await yts(query);
    const video = results.videos[0];
    if (!video) return res.status(404).json({ error: 'No results found' });

    const safeName = video.title.replace(/[^a-z0-9\s]/gi, '').trim().slice(0, 60) || 'song';
    const tmpFile = path.join(os.tmpdir(), `troy_${Date.now()}.mp3`);

    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    await ytDlp.execPromise([
      video.url,
      '-x', '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--ffmpeg-location', __dirname,
      '-o', tmpFile,
      '--no-playlist',
    ]);

    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('end', () => fs.unlink(tmpFile, () => {}));
    stream.on('error', () => fs.unlink(tmpFile, () => {}));

  } catch (err) {
    console.error('Song download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download song.' });
  }
});

// GET /api/download/video?q=westlife — download as MP4 via yt-dlp
app.get('/api/download/video', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  try {
    const results = await yts(query);
    const video = results.videos[0];
    if (!video) return res.status(404).json({ error: 'No results found' });

    const safeName = video.title.replace(/[^a-z0-9\s]/gi, '').trim().slice(0, 60) || 'video';
    const tmpFile = path.join(os.tmpdir(), `troy_${Date.now()}.mp4`);

    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');

    await ytDlp.execPromise([
      video.url,
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--ffmpeg-location', __dirname,
      '-o', tmpFile,
      '--no-playlist',
    ]);

    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('end', () => fs.unlink(tmpFile, () => {}));
    stream.on('error', () => fs.unlink(tmpFile, () => {}));

  } catch (err) {
    console.error('Video download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download video.' });
  }
});

// GET /api/search?q=westlife — just search, return results
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    const results = await yts(query);
    const videos = results.videos.slice(0, 5).map(v => ({
      title: v.title,
      url: v.url,
      duration: v.timestamp,
      views: v.views,
      thumbnail: v.thumbnail,
      author: v.author.name,
    }));
    res.json({ videos });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/discord-webhook — Discord bot pushes events here
app.post('/api/discord-webhook', (req, res) => {
  const secret = req.headers['x-troy-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const { source, content, type } = req.body;
  if (!content) return res.status(400).json({ error: 'Missing content.' });

  const entry = addToLog(source || 'discord', content, type || 'discord');
  res.json({ ok: true, entry });
});

// ── Helper: Forward command to Katamump bot ────────────────
async function forwardToDiscordBot(command) {
  const BOT_URL = process.env.KATAMUMP_BOT_URL;
  const BOT_SECRET = process.env.BOT_API_SECRET;

  if (!BOT_URL) throw new Error('KATAMUMP_BOT_URL not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${BOT_URL}/api/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-troy-secret': BOT_SECRET || '',
      },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Bot responded ${response.status}`);
    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── Helper: Local fallback replies ────────────────────────
function autoReply(command) {
  const cmd = command.toLowerCase();
  if (cmd.startsWith('/help'))   return '📖 Commands: /help, /ping, /status, /say [msg], /discord\n🎵 Media: .song [name], .video [name]';
  if (cmd.startsWith('/ping'))   return '🏓 Pong! Troy Bot is online and listening.';
  if (cmd.startsWith('/status')) return `⚙️ Server uptime: ${Math.floor(process.uptime())}s. All systems nominal.`;
  if (cmd.startsWith('/say '))   return `📣 Echoing to Discord: "${command.slice(5)}"`;
  if (cmd.startsWith('/discord'))return '🔗 Discord invite: discord.gg/your-invite-here';
  if (cmd.startsWith('.song ') || cmd.startsWith('.video ')) return '__MEDIA__';
  return `✅ Command received: "${command}". (Bot offline — running in local mode)`;
}

// ── Serve frontend ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🤖 Troy Bot server running on port ${PORT}`);
});
