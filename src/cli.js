#!/usr/bin/env node

/**
 * ============================================================
 *  SecureLink-CLI  (ipingyou)
 * ============================================================
 *  Secure peer-to-peer remote access via SSH & Cloudflare
 *  Tunnels.  Designed to run via npx or as a global install.
 *
 *  Usage:
 *    npx ipingyou              — Interactive mode
 *    npx ipingyou host         — Start as host directly
 *    npx ipingyou connect      — Start as client directly
 *    npx ipingyou broker       — Start the central broker
 *
 *  Security:
 *    All tunnel URLs are AES-256-CBC encrypted on the CLI side.
 *    The broker is a zero-knowledge relay — it NEVER sees plaintext.
 * ============================================================
 */

import 'dotenv/config';
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';

import { detectOS, checkDependencies } from './lib/platform.js';
import { installShutdownHandlers } from './lib/cleanup.js';
import { startHostMode } from './modes/host.js';
import { startClientMode } from './modes/client.js';

// ─── ASCII Banner ────────────────────────────────────────────
function showBanner() {
  console.log('');
  console.log(chalk.cyan.bold('  ╔═══════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('  ║                                           ║'));
  console.log(chalk.cyan.bold('  ║') + chalk.white.bold('     🔗  iPingYou  —  SecureLink CLI  ') + chalk.cyan.bold('     ║'));
  console.log(chalk.cyan.bold('  ║                                           ║'));
  console.log(chalk.cyan.bold('  ║') + chalk.dim('   Secure P2P Remote Access via SSH +  ') + chalk.cyan.bold('    ║'));
  console.log(chalk.cyan.bold('  ║') + chalk.dim('   Cloudflare Tunnels  |  AES-256-CBC ') + chalk.cyan.bold('    ║'));
  console.log(chalk.cyan.bold('  ║                                           ║'));
  console.log(chalk.cyan.bold('  ╚═══════════════════════════════════════════╝'));
  console.log('');
}

function showSystemInfo() {
  const osInfo = detectOS();
  const platform = osInfo.isLinux ? '🐧 Linux' : osInfo.isMac ? '🍎 macOS' : '🪟 Windows';
  console.log(chalk.dim(`  ${platform}  |  ${osInfo.arch}  |  ${osInfo.hostname}  |  Node ${process.version}`));
  console.log('');
}

function showRichHelp() {
  console.log(chalk.bold.yellow('  ✨ Welcome to iPingYou SecureLink CLI! ✨'));
  console.log(chalk.dim('  ───────────────────────────────────────────────────────'));
  console.log(chalk.cyan('  A zero-knowledge peer-to-peer remote access tool.'));
  console.log(chalk.cyan('  Securely share your local SSH terminal with anyone over the internet.'));
  console.log('');
  
  console.log(chalk.bold.white('  🚀 Usage Modes:'));
  console.log(`    ${chalk.green('host')}    : Generates a secure session UID and exposes your local machine.`);
  console.log(`    ${chalk.blue('connect')} : Prompts for a UID to connect to a remote host.`);
  console.log(`              ${chalk.dim('Supports Interactive SSH Shell & SCP File Transfers')}`);
  console.log(`    ${chalk.yellow('broker')}  : Start your own relay server (for self-hosting).`);
  console.log('');
  
  console.log(chalk.bold.white('  🔒 Security Architecture:'));
  console.log(`    • Cloudflare Tunnels punch through NAT/Firewalls securely.`);
  console.log(`    • ${chalk.green('End-to-End Encryption')}: Tunnel URLs are AES-256 encrypted locally.`);
  console.log(`    • The Broker never sees your plaintext URL, only ciphertext.`);
  console.log('');

  console.log(chalk.bold.white('  💡 Examples:'));
  console.log(`    $ npx ipingyou          ${chalk.dim('# Interactive wizard (Recommended)')}`);
  console.log(`    $ npx ipingyou host     ${chalk.dim('# Quick start as Host')}`);
  console.log(`    $ npx ipingyou connect  ${chalk.dim('# Quick start as Client')}`);
  console.log(`    $ npx ipingyou broker   ${chalk.dim('# Start Relay')}`);
  console.log('');
}

/**
 * Fatal error handler — logs and exits with code 1.
 * @param {string} context  — which command/mode failed
 * @param {Error}  err      — the error object
 */
function fatal(context, err) {
  console.error('');
  console.error(chalk.red(`  ❌ FATAL [${context}]`));
  console.error(chalk.red(`     ${err.message}`));
  if (err.stack) {
    const stackLines = err.stack.split('\n').slice(1, 4);
    stackLines.forEach(line => console.error(chalk.dim(`     ${line.trim()}`)));
  }
  console.error('');
  process.exit(1);
}

// ─── Interactive Mode Selection ──────────────────────────────
async function interactiveMode() {
  showBanner();
  showSystemInfo();

  // Check dependencies first
  const deps = await checkDependencies();

  if (!deps.ssh || !deps.cloudflared) {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Some dependencies are missing. Continue anyway?',
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.dim('  Install the missing tools and try again.'));
      process.exit(0);
    }
  }

  // Mode selection
  const { mode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'What would you like to do?',
      choices: [
        {
          name: `${chalk.green('🛡️  Allow Remote Access')}  ${chalk.dim('— Let someone connect to this machine')}`,
          value: 'host',
        },
        {
          name: `${chalk.blue('🌐 Access a Remote Machine')}  ${chalk.dim('— Connect to a host via their UID (SSH/SCP)')}`,
          value: 'client',
        },
        new inquirer.Separator(),
        {
          name: `${chalk.yellow('📡 Start Broker Server')}  ${chalk.dim('— Run the central relay (for self-hosting)')}`,
          value: 'broker',
        },
        {
          name: `${chalk.magenta('📖 Help / Information')}   ${chalk.dim('— Learn how iPingYou works')}`,
          value: 'help',
        },
      ],
    },
  ]);

  switch (mode) {
    case 'host':
      await startHostMode();
      break;
    case 'client':
      await startClientMode();
      break;
    case 'broker':
      await startBroker();
      break;
    case 'help':
      showRichHelp();
      break;
  }
}

// ─── Broker Start ────────────────────────────────────────────
async function startBroker() {
  console.log(chalk.cyan('  Starting broker server...'));
  console.log('');
  // Dynamically import the server (it self-starts on import)
  await import('./server.js');
}

// ─── Commander Setup ─────────────────────────────────────────
const program = new Command();

program
  .name('ipingyou')
  .description('SecureLink-CLI — Secure P2P remote access via SSH & Cloudflare Tunnels')
  .version('1.0.0')
  .addHelpText('beforeAll', () => {
    showBanner();
    showRichHelp();
    return '';
  });

program
  .command('host')
  .description('Start host mode — allow remote access to this machine')
  .action(async () => {
    try {
      showBanner();
      showSystemInfo();
      installShutdownHandlers();
      await checkDependencies();
      await startHostMode();
    } catch (err) {
      fatal('host', err);
    }
  });

program
  .command('connect')
  .description('Connect to a remote machine via its UID (SSH or SCP)')
  .option('-u, --uid <uid>', 'The remote host UID')
  .action(async () => {
    try {
      showBanner();
      showSystemInfo();
      installShutdownHandlers();
      await checkDependencies();
      await startClientMode();
    } catch (err) {
      fatal('connect', err);
    }
  });

program
  .command('broker')
  .description('Start the central broker server')
  .option('-p, --port <port>', 'Port to listen on', '4000')
  .action(async (opts) => {
    try {
      if (opts.port) process.env.BROKER_PORT = opts.port;
      showBanner();
      await startBroker();
    } catch (err) {
      fatal('broker', err);
    }
  });

// ─── Default: interactive mode ──────────────────────────────
program.action(async () => {
  try {
    installShutdownHandlers();
    await interactiveMode();
  } catch (err) {
    fatal('interactive', err);
  }
});

program.parse();
