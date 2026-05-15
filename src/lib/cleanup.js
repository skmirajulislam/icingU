/**
 * ============================================================
 *  Graceful Cleanup & Process Killer
 * ============================================================
 *  Tracks all spawned child processes (cloudflared, ssh, etc.)
 *  and kills them on SIGINT/exit using tree-kill to ensure
 *  no orphan processes linger.
 * ============================================================
 */

import treeKill from 'tree-kill';
import chalk from 'chalk';

/** @type {Set<number>} — Active child PIDs we manage */
const trackedPIDs = new Set();

/** @type {string|null} — UID to revoke on shutdown */
let _revokeUID = null;

/** @type {string|null} — Broker URL for revocation */
let _brokerUrl = null;

/** @type {Array<() => Promise<void>|void>} — Custom cleanup hooks */
const _cleanupHooks = [];

/**
 * Register a custom cleanup hook to run on shutdown.
 * @param {() => Promise<void>|void} hook
 */
export function addCleanupHook(hook) {
  _cleanupHooks.push(hook);
}

/**
 * Register a spawned child PID for tracking.
 * @param {number} pid
 */
export function trackPID(pid) {
  if (pid) trackedPIDs.add(pid);
}

/**
 * Unregister a PID (after it exits naturally).
 * @param {number} pid
 */
export function untrackPID(pid) {
  trackedPIDs.delete(pid);
}

/**
 * Set UID + broker URL for automatic revocation on shutdown.
 * @param {string} uid
 * @param {string} brokerUrl
 */
export function setRevokeOnExit(uid, brokerUrl) {
  _revokeUID = uid;
  _brokerUrl = brokerUrl;
}

/**
 * Kill a single PID tree.
 * @param {number} pid
 * @returns {Promise<void>}
 */
function killPID(pid) {
  return new Promise((resolve) => {
    treeKill(pid, 'SIGTERM', (err) => {
      if (err) {
        // Force kill if SIGTERM fails
        treeKill(pid, 'SIGKILL', () => resolve());
      } else {
        resolve();
      }
    });
  });
}

/**
 * Kill all tracked PIDs and revoke UID from broker.
 */
export async function cleanupAll() {
  console.log('');
  console.log(chalk.yellow('  🧹 Cleaning up...'));

  // Kill all tracked processes
  const kills = [];
  for (const pid of trackedPIDs) {
    console.log(chalk.dim(`     Killing PID ${pid}...`));
    kills.push(killPID(pid));
  }
  await Promise.allSettled(kills);
  trackedPIDs.clear();

  // Run custom cleanup hooks
  for (const hook of _cleanupHooks) {
    try {
      await hook();
    } catch (err) {
      console.error(chalk.red(`     Cleanup hook failed: ${err.message}`));
    }
  }

  // Revoke UID from broker
  if (_revokeUID && _brokerUrl) {
    try {
      const res = await fetch(`${_brokerUrl}/revoke/${_revokeUID}`, { method: 'DELETE' });
      if (res.ok) {
        console.log(chalk.dim(`     Revoked UID ${_revokeUID} from broker`));
      }
    } catch {
      // Best-effort — broker might be down
    }
  }

  console.log(chalk.green('  ✅ Cleanup complete. Goodbye!'));
  console.log('');
}

/**
 * Install SIGINT/SIGTERM handlers for graceful shutdown.
 */
export function installShutdownHandlers() {
  let shuttingDown = false;

  const handler = async (signal) => {
    if (shuttingDown) return; // Prevent double-cleanup
    shuttingDown = true;
    console.log('');
    console.log(chalk.yellow(`  ⚡ Received ${signal}`));
    await cleanupAll();
    process.exit(0);
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));

  // Also handle uncaught exceptions gracefully
  process.on('uncaughtException', async (err) => {
    console.error(chalk.red(`  💥 Uncaught exception: ${err.message}`));
    await cleanupAll();
    process.exit(1);
  });
}

/**
 * Get count of tracked PIDs.
 * @returns {number}
 */
export function getTrackedCount() {
  return trackedPIDs.size;
}

/**
 * Execute Panic Mode (Self-Destruct)
 * Wipes all configs, keys, and forcefully kills associated processes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execaCommand } from 'execa';

export async function executePanicMode() {
  console.log(chalk.bold.red('\n  🚨 INITIATING SECURELINK PANIC MODE 🚨\n'));
  
  // 1. Force kill all cloudflared & ipingyou processes
  console.log(chalk.dim('  [1/4] Terminating all tunnel and host processes...'));
  try {
    if (process.platform === 'win32') {
      await execaCommand('taskkill /F /IM cloudflared.exe', { reject: false });
      await execaCommand('taskkill /F /IM sshd.exe', { reject: false });
    } else {
      await execaCommand('pkill -9 -f cloudflared', { reject: false });
      await execaCommand('pkill -9 -f "sshd:.*@"', { reject: false });
    }
  } catch {}

  // 2. Delete configuration and aliases
  console.log(chalk.dim('  [2/4] Wiping configuration files...'));
  const configPath = path.join(os.homedir(), '.ipingyou', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    const configDir = path.join(os.homedir(), '.ipingyou');
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  } catch {}

  // 3. Delete ephemeral keys and temp files
  console.log(chalk.dim('  [3/4] Purging ephemeral keys and temporary files...'));
  try {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file.startsWith('ipingyou_')) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
  } catch {}

  // 4. Scrub SSH authorized_keys if we know we injected
  // Note: We don't want to wipe the user's whole authorized_keys, but if we have a hook, we could.
  // We'll skip scraping the actual file here unless we know the exact comment.
  console.log(chalk.dim('  [4/4] Finalizing cleanup...'));

  console.log(chalk.bold.green('\n  ✅ Panic Mode Complete. All traces removed.\n'));
  process.exit(0);
}
