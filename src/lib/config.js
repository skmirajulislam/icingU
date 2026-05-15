import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.ipingyou');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function ensureConfig() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ aliases: {}, settings: {} }, null, 2));
  }
}

export function getConfig() {
  try {
    ensureConfig();
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { aliases: {}, settings: {} };
  }
}

export function saveConfig(config) {
  try {
    ensureConfig();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    throw new Error(`Could not save config: ${err.message}`);
  }
}

export function saveAlias(aliasName, data) {
  const config = getConfig();
  if (!config.aliases) config.aliases = {};
  config.aliases[aliasName] = data;
  saveConfig(config);
}

export function getAlias(aliasName) {
  const config = getConfig();
  return config.aliases?.[aliasName] || null;
}
