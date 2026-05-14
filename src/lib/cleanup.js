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
