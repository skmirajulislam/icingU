/**
 * ============================================================
 *  Client Mode — "Access a Remote Machine"
 * ============================================================
 *  1. Prompt for the remote host's UID
 *  2. Resolve UID → ENCRYPTED blob from the Broker
 *  3. DECRYPT tunnel URL locally using shared key
 *  4. Execute SSH through the Cloudflare tunnel proxy
 *
 *  Security: The broker only returns { iv, ciphertext }.
 *  Decryption happens ONLY on this machine.
 * ============================================================
 */

import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { decrypt } from '../lib/crypto.js';
import { trackPID, untrackPID } from '../lib/cleanup.js';

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:4000';

/**
 * Resolve a UID to a tunnel URL via the broker.
 * The broker returns an encrypted blob; we decrypt locally.
 *
 * @param {string} uid
 * @returns {Promise<string|null>}  The decrypted tunnel URL, or null on failure
 */
async function resolveUID(uid) {
  const spinner = ora(`Resolving UID ${chalk.cyan(uid)}...`).start();

  try {
    const res = await fetch(`${BROKER_URL}/resolve/${uid}`);

    if (res.status === 404) {
      spinner.fail('UID not found — the host may not be online or the session expired');
      return null;
    }
    if (res.status === 410) {
      spinner.fail('UID has expired — ask the host for a new session');
      return null;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // Validate encrypted response
    if (!data.iv || !data.ciphertext) {
      spinner.fail('Broker returned invalid response — missing encrypted data');
      console.error(chalk.red('  ❌ Error: Broker response missing iv or ciphertext'));
      console.error(chalk.dim(`     Received: ${JSON.stringify(Object.keys(data))}`));
      return null;
    }

    // Decrypt locally
    let tunnelUrl;
    try {
      tunnelUrl = decrypt(data.iv, data.ciphertext);
    } catch (decryptErr) {
      spinner.fail('Decryption failed — SECRET_KEY mismatch');
      console.error(chalk.red('  ❌ Error: Could not decrypt tunnel URL'));
      console.error(chalk.red(`     ${decryptErr.message}`));
      console.log(chalk.dim('     Make sure your SECRET_KEY matches the host\'s key.'));
      return null;
    }

    // Validate decrypted URL looks like a tunnel URL
    if (!tunnelUrl.startsWith('https://')) {
      spinner.fail('Decrypted data is not a valid tunnel URL');
      console.error(chalk.red('  ❌ Error: Decrypted value doesn\'t look like a URL'));
      console.log(chalk.dim('     This may indicate a key mismatch.'));
      return null;
    }

    spinner.succeed(`Resolved: ${chalk.dim(tunnelUrl)} ${chalk.green('[decrypted locally]')}`);
    return tunnelUrl;
  } catch (err) {
    spinner.fail(`Broker lookup failed: ${err.message}`);
    console.error(chalk.red(`  ❌ Error: ${err.message}`));

    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      console.log(chalk.dim('     Is the broker running? Try: npx ipingyou broker'));
    }

    return null;
  }
}

/**
 * Extract the hostname from a tunnel URL.
 * @param {string} url — e.g. "https://abc-xyz.trycloudflare.com"
 * @returns {string}    — e.g. "abc-xyz.trycloudflare.com"
 */
function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

/**
 * Prompt for SSH username.
 * @returns {Promise<string>}
 */
async function promptUsername() {
  const { username } = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: 'SSH username on the remote machine:',
      default: process.env.USER || process.env.USERNAME || 'root',
      validate: (v) => v.trim().length > 0 || 'Username is required',
    },
  ]);
  return username.trim();
}

/**
 * Start SSH connection through the Cloudflare tunnel.
 * @param {string} username
 * @param {string} hostname — the tunnel hostname
 */
async function connectSSH(username, hostname) {
  console.log('');
  console.log(chalk.bold('  🔗 Establishing SSH Connection'));
  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(`  ${chalk.cyan('User:')}      ${username}`);
  console.log(`  ${chalk.cyan('Host:')}      ${hostname}`);
  console.log(`  ${chalk.cyan('Proxy:')}     cloudflared access tcp`);
  console.log(`  ${chalk.cyan('Crypto:')}    ${chalk.green('AES-256-CBC E2E')}`);
  console.log('');
  console.log(chalk.dim('  Connecting... (Ctrl+C to abort)'));
  console.log('');

  // Build the SSH command with cloudflared as ProxyCommand
  const proxyCommand = `cloudflared access tcp --hostname ${hostname}`;

  try {
    const child = execa('ssh', [
      '-o', `ProxyCommand=${proxyCommand}`,
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      `${username}@${hostname}`,
    ], {
      stdio: 'inherit', // Pass through terminal I/O
      reject: false,
    });

    trackPID(child.pid);

    const result = await child;
    untrackPID(child.pid);

    if (result.exitCode === 0) {
      console.log('');
      console.log(chalk.green('  ✅ SSH session ended cleanly'));
    } else if (result.exitCode === 255) {
      console.log('');
      console.error(chalk.red('  ❌ SSH connection failed (exit code 255)'));
      console.error(chalk.dim('     Common causes:'));
      console.error(chalk.dim('     • Host is not running the tunnel anymore'));
      console.error(chalk.dim('     • Wrong username'));
      console.error(chalk.dim('     • SSH key not accepted'));
      console.error(chalk.dim('     • cloudflared is not installed'));
    } else {
      console.log('');
      console.error(chalk.red(`  ❌ SSH exited with code ${result.exitCode}`));
      if (result.stderr) {
        console.error(chalk.dim(`     stderr: ${result.stderr.substring(0, 200)}`));
      }
    }
  } catch (err) {
    console.error(chalk.red(`  ❌ SSH error: ${err.message}`));
    if (err.code === 'ENOENT') {
      console.error(chalk.dim('     ssh command not found. Install OpenSSH.'));
    }
  }
}

/**
 * Main Client Mode entry point.
 */
export async function startClientMode() {
  console.log('');
  console.log(chalk.bold.cyan('  🌐 CLIENT MODE — Access a Remote Machine'));
  console.log(chalk.dim('  ──────────────────────────────────────────'));
  console.log('');

  // 1. Get the remote UID
  let uid;
  try {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'uid',
        message: 'Enter the remote host\'s UID:',
        validate: (v) => {
          const trimmed = v.trim();
          if (trimmed.length < 6 || trimmed.length > 16) {
            return 'UID must be 6-16 characters';
          }
          if (!/^[a-z0-9]+$/.test(trimmed)) {
            return 'UID should be lowercase alphanumeric';
          }
          return true;
        },
      },
    ]);
    uid = answer.uid.trim();
  } catch (err) {
    console.error(chalk.red(`\n  ❌ Input error: ${err.message}`));
    process.exit(1);
  }

  // 2. Resolve UID → tunnel URL (decrypts locally)
  const tunnelUrl = await resolveUID(uid);
  if (!tunnelUrl) {
    console.log('');
    try {
      const { retry } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'retry',
          message: 'Try again?',
          default: true,
        },
      ]);
      if (retry) return startClientMode();
    } catch {
      // Ctrl+C during retry prompt
    }
    console.error(chalk.red('  ❌ Could not resolve UID. Exiting.'));
    process.exit(1);
  }

  // 3. Get SSH username
  let username;
  try {
    username = await promptUsername();
  } catch (err) {
    console.error(chalk.red(`\n  ❌ Input error: ${err.message}`));
    process.exit(1);
  }

  // 4. Extract hostname and connect
  const hostname = extractHostname(tunnelUrl);
  await connectSSH(username, hostname);

  // 5. Ask if they want to reconnect
  console.log('');
  try {
    const { reconnect } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reconnect',
        message: 'Reconnect to the same host?',
        default: false,
      },
    ]);
    if (reconnect) {
      await connectSSH(username, hostname);
    }
  } catch {
    // Ctrl+C during reconnect prompt — exit gracefully
  }
}
