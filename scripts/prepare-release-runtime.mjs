import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeVersion = '20.19.0';
const runtimeRoot = join(root, 'release', 'runtime');
const archivePath = join(root, 'release', `node-v${nodeVersion}-win-x64.zip`);
const extractedRoot = join(root, 'release', 'runtime-extracted');
const nodeExecutable = join(runtimeRoot, 'node.exe');
const archiveUrl = `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`;

if (process.platform !== 'win32') {
  throw new Error('The bundled Windows Node runtime can only be prepared on Windows.');
}

if (!existsSync(nodeExecutable)) {
  mkdirSync(dirname(archivePath), { recursive: true });
  const response = await fetch(archiveUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the Node.js runtime: HTTP ${response.status}.`);
  }

  await pipeline(response.body, createWriteStream(archivePath));
  rmSync(extractedRoot, { recursive: true, force: true });
  mkdirSync(extractedRoot, { recursive: true });

  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${quote(archivePath)} -DestinationPath ${quote(extractedRoot)} -Force`,
    ],
    { stdio: 'inherit' },
  );

  const extractedNode = join(extractedRoot, `node-v${nodeVersion}-win-x64`, 'node.exe');
  if (!existsSync(extractedNode)) {
    throw new Error(`The downloaded Node.js archive did not contain ${extractedNode}`);
  }
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });
  const { copyFileSync } = await import('node:fs');
  copyFileSync(extractedNode, nodeExecutable);
}

const installedVersion = execFileSync(nodeExecutable, ['--version'], { encoding: 'utf8' }).trim();
if (installedVersion !== `v${nodeVersion}`) {
  throw new Error(`Bundled Node.js version mismatch: expected v${nodeVersion}, found ${installedVersion}.`);
}

rmSync(archivePath, { force: true });
rmSync(extractedRoot, { recursive: true, force: true });
console.log(`Prepared self-contained Node.js ${installedVersion} runtime at ${nodeExecutable}`);
