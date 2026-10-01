import { createHash } from 'node:crypto';
import { createReadStream, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const setupPath = join(root, 'setup.exe');
const releasePath = join(root, 'release');
const unpackedPath = join(releasePath, 'build', 'win-unpacked');
const installerName = 'StudentHero-Setup.exe';
const archiveName = 'StudentHero-Windows-x64.zip';

if (process.platform !== 'win32') {
  throw new Error('Release packaging requires Windows and PowerShell.');
}

if (!existsSync(setupPath)) {
  throw new Error('setup.exe was not found. Run "npm run build:setup" first.');
}

if (!existsSync(unpackedPath)) {
  throw new Error('win-unpacked/ was not found. Run "npm run build:setup" first.');
}

mkdirSync(releasePath, { recursive: true });

const installerOutput = join(releasePath, installerName);
const archiveOutput = join(releasePath, archiveName);
copyFileSync(setupPath, installerOutput);

execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      'Compress-Archive -Path "release\\build\\win-unpacked\\*" -DestinationPath "release\\StudentHero-Windows-x64.zip" -CompressionLevel Optimal -Force',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      '$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "release\\StudentHero-Windows-x64.zip"))',
      'try { if (-not ($archive.Entries | Where-Object { $_.FullName -eq "StudentHero.exe" })) { throw "StudentHero.exe is missing from the release ZIP." } } finally { $archive.Dispose() }',
    ].join('; '),
  ],
  { cwd: root, stdio: 'inherit' },
);

if (!existsSync(archiveOutput)) {
  throw new Error(`Windows app archive was not created: ${archiveOutput}`);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

const checksums = [];
for (const name of [installerName, archiveName]) {
  checksums.push(`${await sha256(join(releasePath, name))}  ${name}`);
}

writeFileSync(join(releasePath, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`, 'utf8');
console.log(`Release files created in ${releasePath}`);
