# ⚡ Troy Bot — Web + Discord Interface

A full-stack web interface for Troy Bot, hosted on **Render**, connected to a Discord bot on **Katamump** via REST API webhooks.

---

## 📁 Project Structure

```
troybot/
├── server.js          ← Node.js/Express web server (deploy to Render)
├── bot.js             ← Discord bot (deploy to Katamump)
├── package.json
├── .env.example       ← Copy to .env and fill in values
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Run locally
```bash
npm run dev    # with nodemon (auto-restart)
# or
npm start      # production
```

---

## 🌐 Deploying to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Set the following:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Node version:** 18+
5. Add environment variables in Render dashboard:
   ```
   WEBHOOK_SECRET=your_long_random_secret
   KATAMUMP_BOT_URL=https://your-bot.katamump.app
   BOT_API_SECRET=your_long_random_secret
   ```
6. Deploy!

---

## 🤖 Discord Bot (Katamump)

The `bot.js` file runs separately on Katamump.

### Setup
```bash
npm install discord.js express dotenv
```

### Katamump `.env`
```
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_channel_id
WEB_SERVER_URL=https://your-site.onrender.com
WEBHOOK_SECRET=same_secret_as_render
BOT_PORT=4000
```

### How the bridge works

```
User types in browser
       ↓
POST /api/command  (Render web server)
       ↓
POST /api/command  (Katamump bot)
       ↓
Bot executes, optionally sends to Discord channel
       ↓
Returns reply JSON → shown in web chat feed

Discord users type in channel
       ↓
bot.js MessageCreate handler
       ↓
POST /api/discord-webhook  (Render web server)
       ↓
Message appears in web feed within 5 seconds (poll)
```

---

## 🔒 Security

- All cross-server requests use a shared `x-troy-secret` header
- Rate limiting: 30 requests/minute per IP on `/api/`
- Helmet.js sets secure HTTP headers
- Never commit your `.env` file

---

## 🛠️ API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Server health & uptime |
| GET | `/api/messages` | Recent message log |
| POST | `/api/command` | Send command from web |
| POST | `/api/discord-webhook` | Receive events from Discord bot |

---

## 🧩 Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | List available commands |
| `/ping` | Check if bot is alive |
| `/status` | Bot & server uptime |
| `/say [message]` | Send message to Discord channel |
| `/discord` | Get Discord invite link |

---

## 📝 Adding New Commands

In `bot.js`, add a new `else if` block inside the `/api/command` handler:

```js
} else if (command.startsWith('/mycommand')) {
  reply = '✅ My custom command worked!';
}
```

---

## ⚙️ Tech Stack

- **Web Server:** Node.js + Express (Render)
- **Discord Bot:** discord.js (Katamump)
- **Frontend:** Vanilla HTML/CSS/JS
- **Security:** Helmet, express-rate-limit, CORS
- **Communication:** REST webhooks with shared secret auth
