/**
 * ============================================================
 *  SecureLink-CLI — Central Broker Server
 * ============================================================
 *  A lightweight REST relay that pairs hosts and clients via
 *  temporary UIDs.  The broker is a DUMB PIPE — it stores and
 *  returns encrypted blobs without ever seeing plaintext.
 *  Encryption/decryption happens ONLY on the CLI side.
 * ============================================================
 */

import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

// ─── In-memory store — auto-expire after TTL ─────────────────
const TTL_MS = 60 * 60 * 1000; // 1 hour
const store = new Map(); // uid → { iv, ciphertext, createdAt }

function pruneExpired() {
  const now = Date.now();
  for (const [uid, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(uid);
      console.log(`🗑️  Expired UID: ${uid}`);
    }
  }
}

// Run pruning every 5 minutes
setInterval(pruneExpired, 5 * 60 * 1000);

// ─── Routes ──────────────────────────────────────────────────

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeUIDs: store.size });
});

/**
 * POST /register
 * Body: { uid: string, iv: string, ciphertext: string }
 *
 * The broker receives an ALREADY-ENCRYPTED blob from the host CLI.
 * It never decrypts — just stores the { iv, ciphertext } pair.
 */
app.post('/register', (req, res) => {
  try {
    const { uid, iv, ciphertext } = req.body;

    if (!uid || !iv || !ciphertext) {
      return res.status(400).json({ error: 'Missing uid, iv, or ciphertext' });
    }

    if (typeof uid !== 'string' || uid.length < 6 || uid.length > 16) {
      return res.status(400).json({ error: 'Invalid UID format (6-16 chars)' });
    }

    // Validate IV format — must be 32 hex chars (16 bytes)
    if (!/^[a-f0-9]{32}$/i.test(iv)) {
      return res.status(400).json({ error: 'Invalid IV format (expected 32 hex chars)' });
    }

    // Validate ciphertext is non-empty base64
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
      return res.status(400).json({ error: 'Invalid ciphertext' });
    }

    // Store the encrypted blob as-is — broker NEVER decrypts
    store.set(uid, {
      iv,
      ciphertext,
      createdAt: Date.now(),
    });

    console.log(`✅ [${new Date().toLocaleTimeString()}] Registered UID: ${uid} (encrypted, ${ciphertext.length} bytes)`);
    res.json({ status: 'registered', uid, expiresIn: '1 hour' });
  } catch (err) {
    console.error('❌ Register error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /resolve/:uid
 * Returns the ENCRYPTED blob { iv, ciphertext } for a given UID.
 * The client CLI decrypts it locally — the broker never sees plaintext.
 */
app.get('/resolve/:uid', (req, res) => {
  try {
    const { uid } = req.params;
    const entry = store.get(uid);

    if (!entry) {
      return res.status(404).json({ error: 'UID not found or expired' });
    }

    // Check TTL
    if (Date.now() - entry.createdAt > TTL_MS) {
      store.delete(uid);
      return res.status(410).json({ error: 'UID expired' });
    }

    console.log(`🔍 [${new Date().toLocaleTimeString()}] Resolved UID: ${uid} (returning encrypted blob)`);

    // Return encrypted blob — client decrypts
    res.json({ uid, iv: entry.iv, ciphertext: entry.ciphertext });
  } catch (err) {
    console.error('❌ Resolve error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /revoke/:uid
 * Allows host to explicitly remove their UID before expiry.
 */
app.delete('/revoke/:uid', (req, res) => {
  const { uid } = req.params;
  const existed = store.delete(uid);
  console.log(`🚫 [${new Date().toLocaleTimeString()}] Revoked UID: ${uid} (existed: ${existed})`);
  res.json({ status: existed ? 'revoked' : 'not_found' });
});

// ─── Launch ──────────────────────────────────────────────────
// Render injects PORT; locally we use BROKER_PORT; fallback 4000
const PORT = process.env.PORT || process.env.BROKER_PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   🔗  SecureLink Broker — Active         ║');
  console.log(`  ║   📡  Port: ${String(PORT).padEnd(29)}║`);
  console.log('  ║   🔒  Zero-Knowledge Encrypted Store     ║');
  console.log('  ║   ⏱️   TTL: 1 hour per UID                ║');
  console.log('  ║   🚫  Broker NEVER sees plaintext        ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});

export default app;
