// Platform glue (macOS first, Windows kept as a fallback): Chrome binary, ANGLE backend, process-tree kill.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

export const ANGLE = process.env.ANGLE || (process.platform === 'win32' ? 'd3d11' : 'metal');

/** kill a browser process and all its children (GPU process included) */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    else { try { execFileSync('pkill', ['-9', '-P', String(pid)], { stdio: 'ignore' }); } catch {} process.kill(pid, 'SIGKILL'); }
  } catch {}
}
