/**
 * ============================================================
 *  Platform Detection & Dependency Checker
 * ============================================================
 *  Detects OS, checks for ssh/cloudflared, and provides
 *  automated installation guidance per platform.
 * ============================================================
 */

import { execaCommand } from 'execa';
import chalk from 'chalk';
import ora from 'ora';
import os from 'node:os';

/**
 * Detect the current operating system.
 * @returns {{ platform: string, isLinux: boolean, isMac: boolean, isWindows: boolean, distro: string|null }}
 */
export function detectOS() {
  const platform = process.platform;
  const result = {
    platform,
    isLinux: platform === 'linux',
    isMac: platform === 'darwin',
    isWindows: platform === 'win32',
    distro: null,
    arch: os.arch(),
    hostname: os.hostname(),
  };

  return result;
}

/**
 * Detect Linux distribution family.
 * @returns {Promise<string>}  'debian' | 'arch' | 'fedora' | 'unknown'
 */
export async function detectLinuxDistro() {
  try {
    const { stdout } = await execaCommand('cat /etc/os-release', { reject: false });
    const lower = stdout.toLowerCase();
    if (lower.includes('ubuntu') || lower.includes('debian') || lower.includes('kali') || lower.includes('mint')) {
      return 'debian';
    }
    if (lower.includes('arch') || lower.includes('manjaro')) {
      return 'arch';
    }
    if (lower.includes('fedora') || lower.includes('centos') || lower.includes('rhel')) {
      return 'fedora';
    }
  } catch { /* ignore */ }
  return 'unknown';
}

/**
 * Check if a command exists on PATH.
 * @param {string} cmd
 * @returns {Promise<boolean>}
 */
export async function commandExists(cmd) {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    await execaCommand(checkCmd, { reject: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if sudo is available (Linux/macOS).
 * @returns {Promise<boolean>}
 */
export async function hasSudo() {
  if (process.platform === 'win32') return false;
  return commandExists('sudo');
}

/**
 * Install a dependency on the current platform.
 * @param {string} pkg — package name (e.g. 'openssh-server', 'cloudflared')
 * @param {'debian'|'arch'|'fedora'|'mac'|'windows'} distro
 */
export async function installDependency(pkg, distro) {
  const spinner = ora(`Installing ${chalk.cyan(pkg)}...`).start();

  const commands = {
    debian: `sudo apt-get install -y ${pkg}`,
    arch: `sudo pacman -S --noconfirm ${pkg}`,
    fedora: `sudo dnf install -y ${pkg}`,
    mac: `brew install ${pkg}`,
  };

  const cmd = commands[distro];
  if (!cmd) {
    spinner.fail(`No auto-install command for ${distro}. Please install ${pkg} manually.`);
    return false;
  }

  try {
    await execaCommand(cmd, { stdio: 'inherit' });
    spinner.succeed(`${chalk.green(pkg)} installed successfully`);
    return true;
  } catch (err) {
    spinner.fail(`Failed to install ${pkg}: ${err.message}`);
    return false;
  }
}

/**
 * Run full dependency check for ssh and cloudflared.
 * @returns {Promise<{ ssh: boolean, cloudflared: boolean }>}
 */
export async function checkDependencies() {
  const osInfo = detectOS();
  const results = { ssh: false, cloudflared: false };

  console.log('');
  console.log(chalk.bold('  🔍 Dependency Check'));
  console.log(chalk.dim('  ─────────────────────────────────'));

  // Check SSH
  const sshCmd = osInfo.isWindows ? 'ssh' : 'ssh';
  results.ssh = await commandExists(sshCmd);
  console.log(`  ${results.ssh ? chalk.green('✓') : chalk.red('✗')} ssh          ${results.ssh ? chalk.dim('found') : chalk.red('missing')}`);

  // Check cloudflared
  results.cloudflared = await commandExists('cloudflared');
  console.log(`  ${results.cloudflared ? chalk.green('✓') : chalk.red('✗')} cloudflared  ${results.cloudflared ? chalk.dim('found') : chalk.red('missing')}`);

  console.log('');

  // Auto-install logic for missing deps
  if (!results.ssh || !results.cloudflared) {
    if (osInfo.isLinux) {
      const distro = await detectLinuxDistro();
      const canSudo = await hasSudo();

      if (canSudo) {
        console.log(chalk.yellow('  ⚡ Attempting automatic installation...'));
        console.log('');

        if (!results.ssh) {
          const sshPkg = distro === 'arch' ? 'openssh' : 'openssh-server';
          results.ssh = await installDependency(sshPkg, distro);
        }

        if (!results.cloudflared) {
          // cloudflared isn't always in default repos
          console.log(chalk.yellow('  ℹ️  cloudflared must be installed manually:'));
          console.log(chalk.dim('     https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
        }
      } else {
        console.log(chalk.yellow('  ⚠️  sudo not available — cannot auto-install.'));
        console.log(chalk.dim('     Install ssh and cloudflared manually.'));
      }
    } else if (osInfo.isMac) {
      if (!results.cloudflared) {
        console.log(chalk.yellow('  ℹ️  Install cloudflared via Homebrew:'));
        console.log(chalk.cyan('     brew install cloudflared'));
      }
      if (!results.ssh) {
        console.log(chalk.dim('  ℹ️  macOS ships with SSH by default. Enable it in:'));
        console.log(chalk.dim('     System Preferences → Sharing → Remote Login'));
      }
    } else if (osInfo.isWindows) {
      console.log(chalk.yellow('  ⚠️  Windows detected — manual install required:'));
      if (!results.ssh) {
        console.log(chalk.cyan('     winget install Microsoft.OpenSSH.Client'));
        console.log(chalk.dim('     Or enable via: Settings → Apps → Optional Features → OpenSSH'));
      }
      if (!results.cloudflared) {
        console.log(chalk.cyan('     winget install Cloudflare.cloudflared'));
      }
    }
  }

  return results;
}
