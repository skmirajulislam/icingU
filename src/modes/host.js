/**
 * ============================================================
 *  Host Mode — "Allow Remote Access"
 * ============================================================
 *  1. Generate a session UID
 *  2. Ensure local SSH service is running
 *  3. Spawn cloudflared tunnel → localhost:22
 *  4. ENCRYPT tunnel URL locally, send ciphertext to Broker
 *  5. Monitor connections & provide termination controls
 *
 *  Security: The broker NEVER sees the plaintext tunnel URL.
 *  Only someone with the shared SECRET_KEY can decrypt.
 * ============================================================
 */

import { execa, execaCommand } from 'execa';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { generateUID } from '../lib/uid.js';
import { encrypt } from '../lib/crypto.js';
import { trackPID, untrackPID, setRevokeOnExit } from '../lib/cleanup.js';
import { detectOS } from '../lib/platform.js';

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:4000';

/**
 * Ensure the local SSH server is running.
 */
async function ensureSSHRunning() {
  const spinner = ora('Checking SSH service...').start();
  const osInfo = detectOS();

  try {
    if (osInfo.isLinux) {
      // Try systemctl first, fall back to service
      try {
        await execaCommand('systemctl is-active ssh', { reject: true });
        spinner.succeed('SSH service is active');
      } catch {
        spinner.text = 'Starting SSH service...';
        try {
          await execaCommand('sudo systemctl start ssh', { stdio: 'inherit' });
          spinner.succeed('SSH service started');
        } catch {
          // Try sshd variant (Arch, Fedora)
          await execaCommand('sudo systemctl start sshd', { stdio: 'inherit' });
          spinner.succeed('SSH service started (sshd)');
        }
      }
    } else if (osInfo.isMac) {
      // macOS: check Remote Login
      try {
        const { stdout } = await execaCommand('sudo systemsetup -getremotelogin', { reject: false });
        if (stdout.toLowerCase().includes('off')) {
          spinner.text = 'Enabling Remote Login...';
          await execaCommand('sudo systemsetup -setremotelogin on', { stdio: 'inherit' });
          spinner.succeed('Remote Login enabled');
        } else {
          spinner.succeed('SSH (Remote Login) is active');
        }
      } catch {
        spinner.warn('Could not verify SSH status — ensure Remote Login is enabled in System Preferences');
      }
    } else if (osInfo.isWindows) {
      try {
        const { stdout } = await execaCommand('sc query sshd', { reject: false });
        if (stdout.includes('STOPPED')) {
          spinner.text = 'Starting OpenSSH Server...';
          await execaCommand('net start sshd', { stdio: 'inherit' });
          spinner.succeed('OpenSSH Server started');
        } else if (stdout.includes('RUNNING')) {
          spinner.succeed('OpenSSH Server is running');
        } else {
          spinner.warn('OpenSSH Server status unknown — ensure it is installed');
        }
      } catch {
        spinner.warn('Could not check SSH service — ensure OpenSSH Server is installed');
      }
    }
  } catch (err) {
    spinner.fail(`SSH check failed: ${err.message}`);
    console.log(chalk.dim('  Continue anyway? The tunnel will still start, but SSH connections may fail.'));
  }
}

/**
 * Spawn cloudflared tunnel and extract the generated URL.
 * @returns {Promise<{ process: import('execa').ExecaChildProcess, url: string }>}
 */
async function spawnTunnel() {
  const spinner = ora('Starting Cloudflare tunnel...').start();

  return new Promise((resolve, reject) => {
    const child = execa('cloudflared', ['tunnel', '--url', 'ssh://localhost:22'], {
      reject: false,
      all: true, // merge stdout and stderr
    });

    trackPID(child.pid);
    let tunnelUrl = null;
    let resolved = false;

    // cloudflared prints the URL to stderr
    child.all.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[-0-9a-z]+\.trycloudflare\.com/);
      if (match && !resolved) {
        tunnelUrl = match[0];
        resolved = true;
        spinner.succeed(`Tunnel active: ${chalk.cyan(tunnelUrl)}`);
        resolve({ process: child, url: tunnelUrl });
      }
    });

    child.on('exit', (code) => {
      untrackPID(child.pid);
      if (!resolved) {
        spinner.fail('Cloudflare tunnel exited before generating URL');
        reject(new Error(`cloudflared exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      untrackPID(child.pid);
      if (!resolved) {
        spinner.fail(`Tunnel error: ${err.message}`);
        reject(err);
      }
    });

    // Timeout — if no URL after 30s, fail
    setTimeout(() => {
      if (!resolved) {
        spinner.fail('Timeout: No tunnel URL received after 30 seconds');
        reject(new Error('Tunnel timeout'));
      }
    }, 30000);
  });
}

/**
 * Encrypt tunnel URL and register with the Central Broker.
 * The broker receives ONLY the encrypted blob — never plaintext.
 *
 * @param {string} uid
 * @param {string} tunnelUrl
 * @returns {Promise<boolean>}
 */
async function registerWithBroker(uid, tunnelUrl) {
  const spinner = ora('Encrypting & registering with broker...').start();

  try {
    // Encrypt the tunnel URL LOCALLY before sending
    const encrypted = encrypt(tunnelUrl);

    const res = await fetch(`${BROKER_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    spinner.succeed(`Registered with broker ${chalk.dim(`(${BROKER_URL})`)} ${chalk.green('[E2E encrypted]')}`);
    return true;
  } catch (err) {
    spinner.fail(`Broker registration failed: ${err.message}`);
    console.error(chalk.red(`  ❌ Error: ${err.message}`));
    console.log(chalk.yellow('  ⚠️  Remote clients won\'t be able to find you without the broker.'));
    console.log(chalk.dim('     Share the tunnel URL directly if needed.'));
    return false;
  }
}

/**
 * Monitor active connections to port 22.
 * @returns {Promise<string[]>}  List of connected IPs
 */
async function getConnectedIPs() {
  const osInfo = detectOS();
  try {
    let cmd;
    if (osInfo.isWindows) {
      cmd = 'netstat -an | findstr :22 | findstr ESTABLISHED';
    } else {
      cmd = "ss -tn sport = :22 | grep ESTAB | awk '{print $5}' | cut -d: -f1";
    }
    const { stdout } = await execaCommand(cmd, { shell: true, reject: false });
    return stdout.split('\n').filter(Boolean).map(ip => ip.trim());
  } catch {
    return [];
  }
}

/**
 * Display the host dashboard and handle user input.
 */
async function hostDashboard(uid, tunnelUrl) {
  console.log('');
  console.log(chalk.bold('  ╔════════════════════════════════════════════════════╗'));
  console.log(chalk.bold('  ║         🛡️  SecureLink — HOST MODE ACTIVE          ║'));
  console.log(chalk.bold('  ╠════════════════════════════════════════════════════╣'));
  console.log(`  ║  ${chalk.cyan('UID:')}        ${chalk.bold.white(uid)}                              ║`);
  console.log(`  ║  ${chalk.cyan('Tunnel:')}     ${chalk.dim(tunnelUrl.substring(0, 40))}  ║`);
  console.log(`  ║  ${chalk.cyan('Broker:')}     ${chalk.dim(BROKER_URL)}                   ║`);
  console.log(`  ║  ${chalk.cyan('Crypto:')}     ${chalk.green('AES-256-CBC E2E')}                      ║`);
  console.log(chalk.bold('  ╠════════════════════════════════════════════════════╣'));
  console.log(`  ║  ${chalk.yellow('Share this UID with the person who needs access')}   ║`);
  console.log(`  ║  ${chalk.dim('Press Ctrl+C to terminate the session')}              ║`);
  console.log(chalk.bold('  ╚════════════════════════════════════════════════════╝'));
  console.log('');

  // Periodic connection monitoring
  const monitorInterval = setInterval(async () => {
    const ips = await getConnectedIPs();
    if (ips.length > 0) {
      console.log(chalk.cyan(`  📡 Active connections (${ips.length}):`));
      ips.forEach(ip => console.log(chalk.dim(`     → ${ip}`)));
    }
  }, 15000); // Check every 15 seconds

  // Wait for user action
  const waitForAction = async () => {
    try {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Host Controls:',
          choices: [
            { name: '📡 Show connected clients', value: 'show' },
            { name: '🔄 Re-register with broker', value: 'reregister' },
            { name: '🚫 Terminate all connections', value: 'terminate' },
            { name: '❌ Shut down session', value: 'exit' },
          ],
        },
      ]);

      switch (action) {
        case 'show': {
          const ips = await getConnectedIPs();
          if (ips.length === 0) {
            console.log(chalk.dim('  No active connections.'));
          } else {
            console.log(chalk.cyan(`  📡 ${ips.length} connected client(s):`));
            ips.forEach(ip => console.log(`     ${chalk.white('→')} ${ip}`));
          }
          return waitForAction();
        }

        case 'reregister':
          await registerWithBroker(uid, tunnelUrl);
          return waitForAction();

        case 'terminate': {
          const spinner = ora('Terminating active SSH sessions...').start();
          try {
            if (process.platform === 'win32') {
              await execaCommand('taskkill /F /IM sshd.exe', { reject: false });
            } else {
              // Kill established SSH sessions, not the daemon
              await execaCommand("pkill -f 'sshd:.*@'", { shell: true, reject: false });
            }
            spinner.succeed('All client SSH sessions terminated');
          } catch {
            spinner.warn('Could not terminate sessions (none active?)');
          }
          return waitForAction();
        }

        case 'exit':
          clearInterval(monitorInterval);
          return;
      }
    } catch (err) {
      // Handle inquirer being interrupted (Ctrl+C during prompt)
      clearInterval(monitorInterval);
      console.error(chalk.red(`\n  ❌ Dashboard error: ${err.message}`));
      throw err;
    }
  };

  await waitForAction();
}

/**
 * Main Host Mode entry point.
 */
export async function startHostMode() {
  console.log('');
  console.log(chalk.bold.cyan('  🔒 HOST MODE — Allow Remote Access'));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log('');

  // 1. Generate UID
  const uid = generateUID();
  console.log(`  ${chalk.green('✓')} Session UID: ${chalk.bold.white(uid)}`);
  console.log('');

  // 2. Ensure SSH is running
  await ensureSSHRunning();

  // 3. Spawn cloudflared tunnel
  let tunnel;
  try {
    tunnel = await spawnTunnel();
  } catch (err) {
    console.error(chalk.red(`\n  ❌ FATAL: Failed to start tunnel`));
    console.error(chalk.red(`     Error: ${err.message}`));
    console.log(chalk.dim('     Make sure cloudflared is installed and in your PATH.'));
    process.exit(1);
  }

  // 4. Encrypt & register with broker
  const registered = await registerWithBroker(uid, tunnel.url);
  if (!registered) {
    console.error(chalk.red(`\n  ❌ FATAL: Could not register with broker at ${BROKER_URL}`));
    console.log(chalk.dim('     Is the broker running? Try: npx ipingyou broker'));
    process.exit(1);
  }

  // 5. Set up auto-revoke on exit
  setRevokeOnExit(uid, BROKER_URL);

  // 6. Dashboard
  await hostDashboard(uid, tunnel.url);
}
