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
 *
 *  Security:
 *    All tunnel URLs are AES-256-CBC encrypted on the CLI side.
 *    The broker is a zero-knowledge relay — it NEVER sees plaintext.
 * ============================================================
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectOS, checkDependencies } from './lib/platform.js';
import { cleanupAll, installShutdownHandlers, executePanicMode } from './lib/cleanup.js';
import { startHostMode } from './modes/host.js';
import { startClientMode } from './modes/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

// ─── ASCII Banner ────────────────────────────────────────────
const wolfAscii = [
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠁⠸⢳⡄⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠃⠀⠀⢸⠸⠀⡠⣄⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡠⠃⠀⠀⢠⣞⣀⡿⠀⠀⣧⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣠⡖⠁⠀⠀⠀⢸⠈⢈⡇⠀⢀⡏⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⡴⠩⢠⡴⠀⠀⠀⠀⠀⠈⡶⠉⠀⠀⡸⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⢀⠎⢠⣇⠏⠀⠀⠀⠀⠀⠀⠀⠁⠀⢀⠄⡇⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⢠⠏⠀⢸⣿⣴⠀⠀⠀⠀⠀⠀⣆⣀⢾⢟⠴⡇⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⢀⣿⠀⠠⣄⠸⢹⣦⠀⠀⡄⠀⠀⢋⡟⠀⠀⠁⣇⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⢀⡾⠁⢠⠀⣿⠃⠘⢹⣦⢠⣼⠀⠀⠉⠀⠀⠀⠀⢸⡀⠀⠀⠀⠀",
  "⠀⠀⢀⣴⠫⠤⣶⣿⢀⡏⠀⠀⠘⢸⡟⠋⠀⠀⠀⠀⠀⠀⠀⠀⢳⠀⠀⠀⠀",
  "⠐⠿⢿⣿⣤⣴⣿⣣⢾⡄⠀⠀⠀⠀⠳⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢣⠀⠀⠀",
  "⠀⠀⠀⣨⣟⡍⠉⠚⠹⣇⡄⠀⠀⠀⠀⠀⠀⠀⠀⠈⢦⠀⠀⢀⡀⣾⡇⠀⠀",
  "⠀⠀⢠⠟⣹⣧⠃⠀⠀⢿⢻⡀⢄⠀⠀⠀⠀⠐⣦⡀⣸⣆⠀⣾⣧⣯⢻⠀⠀",
  "⠀⠀⠘⣰⣿⣿⡄⡆⠀⠀⠀⠳⣼⢦⡘⣄⠀⠀⡟⡷⠃⠘⢶⣿⡎⠻⣆⠀⠀",
  "⠀⠀⠀⡟⡿⢿⡿⠀⠀⠀⠀⠀⠙⠀⠻⢯⢷⣼⠁⠁⠀⠀⠀⠙⢿⡄⡈⢆⠀",
  "⠀⠀⠀⠀⡇⣿⡅⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠦⠀⠀⠀⠀⠀⠀⡇⢹⢿⡀",
  "⠀⠀⠀⠀⠁⠛⠓⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠼⠇⠁"
];

const titleAscii = [
  "   ___  ____   ___  _   _   ____        _   _  ",
  "  |_ _||  _ \\ |_ _|| \\ | | / ___|      | | | | ",
  "   | | | |_) | | | |  \\| || |  _  ____ | | | | ",
  "   | | |  __/  | | | |\\  || |_| ||____|| |_| | ",
  "  |___||_|    |___||_| \\_| \\____|       \\___/  "
];

function showBanner() {
  console.log('');
  
  const darkBlueGray = chalk.hex('#4B5563').bold;
  const pink = chalk.hex('#FF69B4').bold;
  const titleStartLine = 6;
  
  wolfAscii.forEach((line, index) => {
    let out = chalk.dim(line);
    if (index >= titleStartLine && index < titleStartLine + titleAscii.length) {
       const titleLine = titleAscii[index - titleStartLine];
       const ipingPart = titleLine.substring(0, 36);
       const uPart = titleLine.substring(36);
       out += darkBlueGray(ipingPart) + pink(uPart);
    }
    console.log('  ' + out);
  });
  
  console.log('');
  console.log(chalk.cyan.bold('  ╔═══════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('  ║                                           ║'));
  console.log(chalk.cyan.bold('  ║') + chalk.white.bold('     🔗  iPingYou  —  SecureLink CLI  ') + chalk.cyan.bold('     ║'));
  console.log(chalk.cyan.bold('  ║') + chalk.yellow.bold('           by SK MIRAJUL ISLAM         ') + chalk.cyan.bold('    ║'));
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
  console.log('');
  
  console.log(chalk.bold.white('  🔒 Security Architecture:'));
  console.log(`    • Cloudflare Tunnels punch through NAT/Firewalls securely.`);
  console.log(`    • ${chalk.green('End-to-End Encryption')}: Tunnel URLs are AES-256 encrypted locally.`);
  console.log(`    • The Broker never sees your plaintext URL, only ciphertext.`);
  console.log('');

  console.log(chalk.bold.white('  🔥 Advanced Features:'));
  console.log(`    • ${chalk.green('Terminal Mirroring')}   : Host can spectate connected SSH clients in real-time.`);
  console.log(`    • ${chalk.green('Reverse Forwarding')} : Clients can expose their local localhost ports back to the Host.`);
  console.log(`    • ${chalk.green('E2E Chat Room')}      : Real-time Web Crypto AES-GCM secure chat UI for Host & Clients.`);
  console.log(`    • ${chalk.green('Daemonization')}      : Run Host mode as a background service via PM2.`);
  console.log(`    • ${chalk.green('Panic Kill-Switch')}  : Instantly purge all processes, configurations, and traces.`);
  console.log('');

  console.log(chalk.bold.white('  💡 Examples:'));
  console.log(`    $ npx ipingyou                  ${chalk.dim('# Interactive wizard (Recommended)')}`);
  console.log(`    $ npx ipingyou host             ${chalk.dim('# Quick start as Host')}`);
  console.log(`    $ npx ipingyou connect          ${chalk.dim('# Quick start as Client')}`);
  console.log(`    $ npx ipingyou panic            ${chalk.dim('# Self-destruct and wipe memory/traces')}`);
  console.log(`    $ npx ipingyou service install  ${chalk.dim('# Install Host mode as a background daemon')}`);
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
  cleanupAll().finally(() => process.exit(1));
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
    case 'help':
      showRichHelp();
      break;
  }
}

// ─── Commander Setup ─────────────────────────────────────────
const program = new Command();

program
  .name('ipingyou')
  .description('SecureLink-CLI — Secure P2P remote access via SSH & Cloudflare Tunnels')
  .version(packageJson.version)
  .option('-b, --broker <url>', 'Override the central broker URL')
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
      const opts = program.opts();
      if (opts.broker) process.env.BROKER_URL = opts.broker;

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
  .action(async (commandOptions) => {
    try {
      const opts = program.opts();
      if (opts.broker) process.env.BROKER_URL = opts.broker;

      showBanner();
      showSystemInfo();
      installShutdownHandlers();
      await checkDependencies();
      await startClientMode({ uid: commandOptions.uid });
    } catch (err) {
      fatal('connect', err);
    }
  });

program
  .command('panic')
  .description('🚨 Self-destruct mode: wipe all configs, kill tunnels, and remove traces')
  .action(async () => {
    try {
      showBanner();
      await executePanicMode();
    } catch (err) {
      fatal('panic', err);
    }
  });

program
  .command('service <action>')
  .description('👻 Manage background daemon (actions: install, stop, status)')
  .action(async (action) => {
    try {
      showBanner();
      console.log(chalk.bold.cyan('  👻 Background Service Manager'));
      console.log(chalk.dim('  ──────────────────────────────────────'));
      
      const { execaCommand } = await import('execa');
      
      if (action === 'install') {
        console.log(chalk.dim('  Installing PM2 globally and starting host...'));
        await execaCommand('npm install -g pm2', { stdio: 'inherit' });
        await execaCommand('pm2 start ipingyou --name "ipingyou-host" -- host', { stdio: 'inherit' });
        await execaCommand('pm2 save', { stdio: 'inherit' });
        await execaCommand('pm2 startup', { stdio: 'inherit' });
        console.log(chalk.green('\n  ✅ Service installed and running in the background.'));
      } else if (action === 'stop') {
        await execaCommand('pm2 stop ipingyou-host', { stdio: 'inherit' });
        await execaCommand('pm2 delete ipingyou-host', { stdio: 'inherit' });
        await execaCommand('pm2 save', { stdio: 'inherit' });
        console.log(chalk.green('\n  ✅ Service stopped and removed.'));
      } else if (action === 'status') {
        await execaCommand('pm2 status ipingyou-host', { stdio: 'inherit' });
      } else {
        console.log(chalk.red(`  ❌ Unknown action: ${action}. Use install, stop, or status.`));
      }
    } catch (err) {
      fatal('service', err);
    }
  });

// ─── Default: interactive mode ──────────────────────────────
program.action(async () => {
  try {
    const opts = program.opts();
    if (opts.broker) process.env.BROKER_URL = opts.broker;

    installShutdownHandlers();
    await interactiveMode();
  } catch (err) {
    fatal('interactive', err);
  }
});

program.parse();
