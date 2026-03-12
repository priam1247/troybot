'use strict';

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https:", "blob:"],
      mediaSrc:   ["'self'", "https:", "blob:"],
      imgSrc:     ["'self'", "data:", "https:"],
      frameSrc:   ["'self'", "https://www.youtube-nocookie.com", "https://audiomack.com"],
    },
  },
}));

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 60000, max: 60 }));

const messageLog = [];
function addToLog(source, content, type) {
  type = type || 'info';
  const entry = {
    id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    source, content, type,
    timestamp: new Date().toISOString(),
  };
  messageLog.unshift(entry);
  if (messageLog.length > 100) messageLog.length = 100;
  return entry;
}

function fmtDuration(ms) {
  if (!ms || isNaN(ms)) return '';
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function safeFetch(url, opts, retries) {
  retries = retries || 2;
  const base = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'Accept': 'application/json, */*' } };
  const options = Object.assign({}, base, opts || {});
  if (opts && opts.headers) options.headers = Object.assign({}, base.headers, opts.headers);
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t    = setTimeout(function() { ctrl.abort(); }, 12000);
      const res  = await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
      clearTimeout(t);
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await sleep(700 * (i + 1));
    }
  }
}

/* ---- SOURCE 1: YOUTUBE (googleapis.com — works on Railway) ---- */
async function searchYouTube(query) {
  const KEY = process.env.YOUTUBE_API_KEY;
  if (!KEY) throw new Error('YOUTUBE_API_KEY not set');
  const url = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    part: 'snippet', q: query + ' official audio',
    type: 'video', videoCategoryId: '10', maxResults: '10', key: KEY,
  });
  console.log('[YouTube] Searching: "' + query + '"');
  const res = await safeFetch(url, {}, 2);
  if (!res.ok) throw new Error('YouTube API ' + res.status);
  const data = await res.json();
  if (!data.items || !data.items.length) throw new Error('YouTube: no results');
  const queue = data.items.filter(function(v) { return v.id && v.id.videoId; }).slice(0, 8).map(function(v) {
    const s = v.snippet || {};
    const thumb = s.thumbnails ? ((s.thumbnails.high || s.thumbnails.medium || s.thumbnails.default) || {}).url || '' : '';
    const vid = v.id.videoId;
    return { title: s.title || 'Unknown', author: s.channelTitle || 'Unknown', thumbnail: thumb, duration: '',
      videoId: vid, embedSrc: 'https://www.youtube-nocookie.com/embed/' + vid + '?autoplay=1&rel=0&modestbranding=1',
      trackUrl: 'https://www.youtube.com/watch?v=' + vid, source: 'youtube' };
  });
  if (!queue.length) throw new Error('YouTube: no valid videos');
  console.log('[YouTube] Found: "' + queue[0].title + '"');
  return Object.assign({}, queue[0], { queue, source: 'youtube' });
}

/* ---- SOURCE 2: iTUNES (free, 30s previews, no auth) ---- */
async function searchItunes(query) {
  const url = 'https://itunes.apple.com/search?' + new URLSearchParams({ term: query, media: 'music', entity: 'song', limit: '15', country: 'US' });
  console.log('[iTunes] Searching: "' + query + '"');
  const res = await safeFetch(url, {}, 3);
  if (!res.ok) throw new Error('iTunes ' + res.status);
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error('iTunes: no results');
  const tracks = data.results.filter(function(t) { return t.previewUrl && t.kind === 'song'; });
  if (!tracks.length) throw new Error('iTunes: no previews');
  const queue = tracks.slice(0, 10).map(function(t) {
    return { title: t.trackName || 'Unknown', author: t.artistName || 'Unknown', album: t.collectionName || '',
      thumbnail: (t.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
      duration: fmtDuration(t.trackTimeMillis), previewUrl: t.previewUrl, trackUrl: t.trackViewUrl || '', source: 'itunes' };
  });
  console.log('[iTunes] Found: "' + queue[0].title + '" (' + queue.length + ' tracks)');
  return Object.assign({}, queue[0], { queue, source: 'itunes' });
}

/* ---- SOURCE 3: AUDIOMACK (full songs, great for African music) ---- */
async function searchAudiomack(query) {
  const url = 'https://audiomack.com/search?q=' + encodeURIComponent(query) + '&type=song';
  console.log('[Audiomack] Searching: "' + query + '"');
  const res = await safeFetch(url, { headers: { 'Accept': 'text/html,*/*' } }, 2);
  if (!res.ok) throw new Error('Audiomack ' + res.status);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Audiomack: no page data');
  let page;
  try { page = JSON.parse(match[1]); } catch (e) { throw new Error('Audiomack: parse failed'); }
  const props = page && page.props && page.props.pageProps;
  let results = [];
  if (props && props.searchData && props.searchData.results && props.searchData.results.songs)
    results = props.searchData.results.songs.data || [];
  else if (props && props.initialData && props.initialData.songs)
    results = props.initialData.songs.data || [];
  if (!results.length) throw new Error('Audiomack: no results');
  const queue = results.slice(0, 8).map(function(t) {
    const as = (t.artist && t.artist.url_slug) || (t.uploader && t.uploader.url_slug) || '';
    const ss = t.url_slug || '';
    if (!as || !ss) return null;
    return { title: t.title || 'Unknown', author: (t.artist && t.artist.name) || (t.uploader && t.uploader.name) || 'Unknown',
      thumbnail: t.image || '', duration: t.duration ? fmtDuration(t.duration * 1000) : '',
      embedSrc: 'https://audiomack.com/embed/song/' + as + '/' + ss + '?background=1&color=ff6b2b',
      trackUrl: 'https://audiomack.com/song/' + as + '/' + ss, source: 'audiomack' };
  }).filter(Boolean);
  if (!queue.length) throw new Error('Audiomack: no valid slugs');
  console.log('[Audiomack] Found: "' + queue[0].title + '"');
  return Object.assign({}, queue[0], { queue, source: 'audiomack' });
}

/* ---- ORCHESTRATOR ---- */
async function searchMusic(query) {
  try { return await searchYouTube(query); }  catch (e) { console.warn('[YouTube] ' + e.message); }
  try { return await searchItunes(query); }   catch (e) { console.warn('[iTunes] '  + e.message); }
  try { return await searchAudiomack(query); } catch (e) { console.warn('[Audiomack] ' + e.message); }
  throw new Error('All sources failed for "' + query + '"');
}

/* ---- ROUTES ---- */
app.get('/api/status', function(req, res) {
  res.json({ online: true, uptime: process.uptime(), messageCount: messageLog.length,
    youtubeKey: !!process.env.YOUTUBE_API_KEY, timestamp: new Date().toISOString() });
});

app.get('/api/messages', function(req, res) {
  res.json({ messages: messageLog.slice(0, Math.min(parseInt(req.query.limit) || 20, 50)) });
});


// Lyrics proxy - avoids CORS from browser
app.get('/api/lyrics', async function(req, res) {
  const { artist, title } = req.query;
  if (!artist || !title) return res.status(400).json({ error: 'Missing artist or title' });
  try {
    const url = 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
    const r = await safeFetch(url, {}, 1);
    const data = await r.json();
    res.json({ lyrics: data.lyrics || null });
  } catch (e) {
    res.json({ lyrics: null, error: e.message });
  }
});

app.post('/api/command', async function(req, res) {
  const { command } = req.body || {};
  if (!command || typeof command !== 'string') return res.status(400).json({ error: 'Missing command.' });
  const trimmed   = command.trim().slice(0, 300);
  const userEntry = addToLog('web', trimmed, 'command');
  const cmd       = trimmed.toLowerCase();

  if (cmd === '.delete') {
    messageLog.length = 0;
    return res.json({ userEntry, botEntry: addToLog('troy-bot', 'Chat cleared!', 'response'), cleared: true });
  }

  if (cmd.startsWith('.song ')) {
    const query = trimmed.slice(6).trim();
    if (!query) return res.json({ userEntry, botEntry: addToLog('troy-bot', 'Usage: .song [song name]', 'response') });
    try {
      const track  = await searchMusic(query);
      const labels = { youtube: 'YouTube (full song)', itunes: 'iTunes (30s preview)', audiomack: 'Audiomack (full song)' };
      return res.json({ userEntry,
        botEntry:  addToLog('troy-bot', 'Now playing: ' + track.title + ' by ' + track.author + ' [' + (labels[track.source] || track.source) + ']', 'player'),
        trackInfo: track });
    } catch (err) {
      return res.json({ userEntry, botEntry: addToLog('troy-bot', 'Could not find "' + query + '". Try being more specific.', 'error') });
    }
  }

  let botReply = null;
  try { botReply = await forwardToDiscordBot(trimmed); } catch (e) {}
  return res.json({ userEntry, botEntry: addToLog('troy-bot', (botReply && botReply.reply) || autoReply(trimmed), 'response') });
});

app.post('/api/discord-webhook', function(req, res) {
  if (req.headers['x-troy-secret'] !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized.' });
  const { source, content, type } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Missing content.' });
  res.json({ ok: true, entry: addToLog(source || 'discord', content, type || 'discord') });
});

async function forwardToDiscordBot(command) {
  const BOT_URL = process.env.KATAMUMP_BOT_URL;
  if (!BOT_URL) throw new Error('No bot URL');
  const ctrl = new AbortController();
  const t = setTimeout(function() { ctrl.abort(); }, 5000);
  try {
    const r = await fetch(BOT_URL + '/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-troy-secret': process.env.BOT_API_SECRET || '' },
      body: JSON.stringify({ command }), signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('Bot ' + r.status);
    return await r.json();
  } catch (e) { clearTimeout(t); throw e; }
}

function autoReply(command) {
  const c = command.toLowerCase();
  if (c.startsWith('/help'))    return 'Commands: /help /ping /status | Music: .song [name] (searches local library) | Load music: click 💾 button | Chat: .delete';
  if (c.startsWith('/ping'))    return 'Pong! Troy Bot is live.';
  if (c.startsWith('/status'))  return 'Uptime: ' + Math.floor(process.uptime()) + 's | YouTube: ' + (process.env.YOUTUBE_API_KEY ? 'active' : 'no key') + ' | All systems go.';
  if (c.startsWith('/say '))    return 'Echoing: "' + command.slice(5) + '"';
  if (c.startsWith('/discord')) return 'Discord: discord.gg/your-invite-here';
  return 'Command received: "' + command + '". Try .song [name] to stream music!';
}

app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, function() {
  console.log('Troy Bot running on port ' + PORT);

  console.log('Source: Local files only');
});
