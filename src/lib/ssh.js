import crypto from 'node:crypto';

export function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

export function quoteRemoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function formatRemoteCd(remotePath) {
  const trimmed = String(remotePath || '').trim();
  if (!trimmed || trimmed === '~') return '';
  return quoteRemoteShell(trimmed);
}

export function formatScpRemotePath(remotePath) {
  const trimmed = String(remotePath || '').trim();
  if (!trimmed || trimmed === '~') return trimmed || '~';
  return trimmed;
}

export function getSshControlOptions(hostname) {
  if (process.platform === 'win32') return [];
  const hash = crypto.createHash('sha1').update(hostname).digest('hex').slice(0, 10);
  return [
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPersist=5m',
    '-o', `ControlPath=/tmp/ipingyou-${process.pid}-${hash}-%r.sock`,
  ];
}

export function buildSshArgs(hostname, privateKeyPath, extraOptions = []) {
  const proxyCommand = `cloudflared access tcp --hostname ${hostname}`;
  const sshArgs = [
    '-o', `ProxyCommand=${proxyCommand}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'IdentitiesOnly=yes',
    ...getSshControlOptions(hostname),
    ...extraOptions,
  ];

  if (privateKeyPath) {
    sshArgs.push('-i', privateKeyPath, '-o', 'IdentityAgent=none');
  }

  return sshArgs;
}
