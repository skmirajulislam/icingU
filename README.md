# 🔗 iPingYou — SecureLink CLI

Secure peer-to-peer remote access via SSH & Cloudflare Tunnels. A zero-configuration Node.js CLI tool that lets two machines establish an encrypted SSH connection through Cloudflare's network, instantly.

## Architecture

```
 Host Machine                                                     Client Machine
┌──────────────┐   POST                          GET       ┌──────────────┐
│ cloudflared  │──/register──▶[Broker Server]◀─/resolve──│   ipingyou   │
│ tunnel :22   │   {uid,url}  (Render Hosted)    /:uid     │   connect    │
│              │              AES-256-CBC                  │              │
│  SSH daemon  │◀─────────────               ─────────────│  SSH via     │
│              │  cloudflared                 ProxyCmd    │  ProxyCmd    │
└──────────────┘  TCP proxy                                └──────────────┘
```

### Flow
1. **Host** starts `ipingyou host` → generates an 8-char UID, spins up `cloudflared` tunnel, and registers with the broker.
2. **Host** shares the UID with the client.
3. **Client** runs `ipingyou connect` → enters UID, broker resolves it to tunnel URL → SSH connects via cloudflared proxy.
4. On `Ctrl+C`, all spawned processes are killed via `tree-kill` and the UID is automatically revoked from the broker.

## Usage

You do not need to clone the repository or configure any `.env` files. `iPingYou` is purely published on npm and handles the backend API automatically!

### The "On-the-Fly" Way (Recommended)
Run it anywhere using `npx` (make sure you aren't inside the project source code folder):

```bash
# Start the interactive wizard
npx @miraj181/ipingyou

# Or instantly start as a Host
npx @miraj181/ipingyou host

# Or instantly connect as a Client
npx @miraj181/ipingyou connect
```

### Global Install
If you use the tool frequently, install it globally:

```bash
npm install -g @miraj181/ipingyou

# Run as native commands:
ipingyou
securelink
```

## Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| Node.js ≥18 | ✅ | [nodejs.org](https://nodejs.org) |
| `ssh` | ✅ | Ships with macOS/Linux; `winget install Microsoft.OpenSSH.Client` on Windows |
| `cloudflared` | ✅ | `brew install cloudflared` / [download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |

*The CLI auto-detects your OS and will attempt to guide you on how to install missing dependencies!*

## Security

- **Zero-Knowledge Architecture** — The broker never sees the plaintext Cloudflare URL. It is strictly used as an encrypted key-value store.
- **AES-256-CBC** — Tunnel URLs are encrypted locally before being transmitted to the broker.
- **Random UIDs** — 8-char nanoid, not hardware-based. When the session dies, the door is locked forever.
- **Auto-revoke** — On `Ctrl+C`, UID is immediately deleted from the broker before exit.
- **No Persistence** — Broker uses an in-memory Map only with strict 1-hour TTLs.

## License

MIT
