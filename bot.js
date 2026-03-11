/**
 * Troy Bot — Discord Bot Side (Katamump)
 * ─────────────────────────────────────────────────────────────
 * This file runs on your Katamump-hosted environment.
 * It uses discord.js to connect to Discord and exposes
 * a small Express API so the Render web server can talk to it.
 *
 * Install:  npm install discord.js express dotenv
 * Start:    node bot.js
 * ─────────────────────────────────────────────────────────────
 */

const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
require('dotenv').config();

const BOT_TOKEN     = process.env.DISCORD_TOKEN;         // your bot token
const CHANNEL_ID    = process.env.DISCORD_CHANNEL_ID;    // channel to mirror commands
const WEB_URL       = process.env.WEB_SERVER_URL;        // Render URL: https://troybot.onrender.com
const SHARED_SECRET = process.env.WEBHOOK_SECRET;        // must match web server's .env
const PORT          = process.env.BOT_PORT || 4000;

// ── Discord Client ────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, c => {
  console.log(`✅ Troy Bot logged in as ${c.user.tag}`);
});

// ── When a Discord message is sent ───────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.channelId !== CHANNEL_ID) return;

  // Forward Discord message to web server
  try {
    await fetch(`${WEB_URL}/api/discord-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-troy-secret': SHARED_SECRET,
      },
      body: JSON.stringify({
        source: 'discord',
        content: `${message.author.username}: ${message.content}`,
        type: 'discord',
      }),
    });
  } catch (err) {
    console.error('Could not forward Discord message to web:', err.message);
  }
});

// ── Express API (called by the web server) ────────────────
const app = express();
app.use(express.json());

/**
 * POST /api/command
 * Web server forwards user commands here.
 * We execute them and return a reply.
 */
app.post('/api/command', async (req, res) => {
  const secret = req.headers['x-troy-secret'];
  if (secret !== SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Missing command' });

  // ── Built-in command handlers ──────────────────────────
  let reply = '';

  if (command.startsWith('/ping')) {
    reply = '🏓 Pong! Discord bot is alive.';

  } else if (command.startsWith('/status')) {
    reply = `✅ Bot uptime: ${Math.floor(process.uptime())}s. Connected to Discord.`;

  } else if (command.startsWith('/say ')) {
    const msg = command.slice(5);
    try {
      console.log('Channel ID being used:', CHANNEL_ID);
      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send(`📣 Web command: ${msg}`);
      reply = `✅ Sent to Discord: "${msg}"`;
    } catch(err) {
      console.log('Error:', err.message);
      reply = '❌ Could not send to Discord channel.';
    }

  } else if (command.startsWith('/help')) {
    reply = '📖 Commands: /ping, /status, /say [msg], /help, /discord';

  } else if (command.startsWith('/discord')) {
    reply = `🔗 Join our Discord: discord.gg/your-invite-here`;

  } else {
    // Echo unknown commands to the Discord channel
    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send(`🌐 Web command received: \`${command}\``);
      reply = `📨 Command forwarded to Discord: "${command}"`;
    } catch {
      reply = `⚠️ Unknown command: "${command}" (could not reach channel)`;
    }
  }

  res.json({ reply });
});

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🔌 Bot API listening on port ${PORT}`));
client.login(BOT_TOKEN);
