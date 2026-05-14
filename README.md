# 🔗 iPingYou — SecureLink CLI

Secure peer-to-peer remote access via SSH & Cloudflare Tunnels. A Node.js CLI tool that lets two machines establish an encrypted SSH connection through Cloudflare's network, coordinated by a lightweight broker.

## Architecture

```
 Host Machine                  Broker (Express.js)              Client Machine
┌──────────────┐   POST       ┌──────────────────┐   GET       ┌──────────────┐
│ cloudflared  │──/register──▶│  In-Memory Map   │◀─/resolve──│  ipingyou    │
│ tunnel :22   │   {uid,url}  │  AES-256-CBC     │   /:uid     │  connect     │
│              │              │  1hr TTL expiry   │             │              │
│  SSH daemon  │◀─────────────│──────────────────│─────────────│  SSH via     │
│              │  cloudflared │                   │ ProxyCmd    │  ProxyCmd    │
└──────────────┘  TCP proxy   └──────────────────┘             └──────────────┘
```

### Flow
1. **Host** starts `ipingyou host` → generates an 8-char UID, spins up `cloudflared` tunnel, registers with broker
2. **Host** shares UID with the client (verbally, chat, etc.)
3. **Client** runs `ipingyou connect` → enters UID, broker resolves it to tunnel URL → SSH connects via cloudflared proxy
4. On `Ctrl+C`, all spawned processes are killed via `tree-kill` and the UID is revoked from the broker

## Quick Start

### 1. Start the Broker (self-hosted or Render)

```bash
cd ipingyou
cp .env.example .env
npm install
npm run broker
# Broker: http://localhost:4000
```

### 2. Host Mode (Machine being accessed)

```bash
npx ipingyou host
# or interactively:
npx ipingyou
```

### 3. Client Mode (Machine accessing)

```bash
npx ipingyou connect
# or interactively:
npx ipingyou
```

## CLI Commands

```
ipingyou                    Interactive mode (prompts for host/client)
ipingyou host               Start as host — allow remote access
ipingyou connect            Start as client — access a remote machine
ipingyou broker             Start the central broker server
ipingyou broker -p 5000     Start broker on custom port
```

## Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| Node.js ≥18 | ✅ | [nodejs.org](https://nodejs.org) |
| `ssh` | ✅ | Ships with macOS/Linux; `winget install Microsoft.OpenSSH.Client` on Windows |
| `cloudflared` | ✅ | `brew install cloudflared` / [download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |

The CLI auto-detects your OS and will attempt to install missing dependencies on Linux (apt/pacman) and guide you on macOS/Windows.

## Project Structure

```
ipingyou/
├── src/
│   ├── cli.js              ← Main CLI entry (npx-ready, shebang)
│   ├── server.js           ← Central Broker (Express.js)
│   ├── lib/
│   │   ├── cleanup.js      ← Graceful shutdown + tree-kill
│   │   ├── crypto.js       ← AES-256-CBC encrypt/decrypt
│   │   ├── platform.js     ← OS detection + dependency check
│   │   └── uid.js          ← Random 8-char UID generator (nanoid)
│   └── modes/
│       ├── host.js         ← Host mode logic
│       └── client.js       ← Client mode logic
├── .env.example
├── .gitignore
├── package.json
├── render.yaml             ← One-click Render deploy
└── README.md
```

## Security

- **AES-256-CBC** — Tunnel URLs are encrypted at rest in the broker's memory
- **Random UIDs** — 8-char nanoid, not hardware-based; session dies = door locked forever
- **1-hour TTL** — Broker auto-expires entries; no stale data
- **Auto-revoke** — On `Ctrl+C`, UID is deleted from broker before exit
- **tree-kill** — All child processes (cloudflared, SSH) are recursively killed on shutdown
- **No persistence** — Broker uses in-memory Map only; server restart = clean slate

## Deploy Broker to Render (Free)

1. Push this repo to GitHub
2. Go to [render.com/new](https://render.com/new)
3. Click **"New Web Service"** → connect your repo
4. Render auto-detects `render.yaml` → click **Deploy**
5. Set `SECRET_KEY` in Render Dashboard → Environment
6. Set `BROKER_URL` in your local `.env` to your Render URL

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | Dev key | AES-256 hex key (64 chars) |
| `BROKER_URL` | `http://localhost:4000` | Broker endpoint for CLI |
| `BROKER_PORT` | `4000` | Port for broker server |

## Differences from remote-penitrator

| Aspect | remote-penitrator | iPingYou |
|--------|-------------------|----------|
| Interface | Shell scripts + web dashboard | Interactive Node.js CLI |
| Direction | One-way (runner → C2) | Peer-to-peer (host ↔ client) |
| UID System | Hardcoded PC IDs | Random per-session UIDs |
| Process Mgmt | Manual | tree-kill auto-cleanup |
| Install | Copy scripts | `npx ipingyou` |
| Modes | Reporter only | Host + Client + Broker |

## License

MIT
