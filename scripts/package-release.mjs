import { createHash } from 'node:crypto';
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const setupPath = resolve(process.env.STUDENTHERO_SETUP_PATH || join(root, 'setup.exe'));
const releasePath = resolve(process.env.STUDENTHERO_RELEASE_DIR || join(root, 'release', 'artifacts'));
const unpackedPath = resolve(process.env.STUDENTHERO_UNPACKED_PATH || join(root, 'release', 'build', 'win-unpacked'));
const installerName = 'StudentHero-Setup.exe';
const archiveName = 'StudentHero-Windows-x64.zip';
const checksumName = 'checksums.txt';
const packagedFiles = [
  'StudentHero.exe',
  'resources/studenthero/runtime/node.exe',
  'resources/studenthero/dist/index.html',
  'resources/studenthero/dist-server/worker.js',
  'resources/studenthero/scripts/launch-zoom-task.ps1',
  'resources/studenthero/scripts/take-zoom-screenshot.ps1',
  'resources/studenthero/scripts/sleep-mode.ps1',
  'resources/assets/StudentHero.ico',
];

if (process.platform !== 'win32') {
  throw new Error('Release packaging requires Windows and PowerShell.');
}

if (!existsSync(setupPath)) {
  throw new Error('setup.exe was not found. Run "npm run build:setup" first.');
}

if (!existsSync(unpackedPath)) {
  throw new Error('The unpacked Electron app is missing. Run "npm run build:setup" first.');
}

if (releasePath === root || releasePath === dirname(root)) {
  throw new Error(`Refusing to clean unsafe release directory: ${releasePath}`);
}

for (const file of packagedFiles) {
  if (!existsSync(join(unpackedPath, file))) {
    throw new Error(`The self-contained Windows app is missing ${file}.`);
  }
}

mkdirSync(releasePath, { recursive: true });
const releaseNames = new Set([installerName, archiveName, checksumName]);
for (const entry of readdirSync(releasePath)) {
  if (!releaseNames.has(entry)) {
    rmSync(join(releasePath, entry), { recursive: true, force: true });
  }
}

const installerOutput = join(releasePath, installerName);
const archiveOutput = join(releasePath, archiveName);
copyFileSync(setupPath, installerOutput);

execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${join(unpackedPath, '*').replace(/'/g, "''")}' -DestinationPath '${archiveOutput.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`,
  ],
  { cwd: root, stdio: 'inherit' },
);

if (!existsSync(archiveOutput)) {
  throw new Error(`Windows app archive was not created: ${archiveOutput}`);
}

const archiveCheck = [
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  `$archive = [System.IO.Compression.ZipFile]::OpenRead('${archiveOutput.replace(/'/g, "''")}')`,
  `$required = @(${packagedFiles.map((file) => `'${file.replace(/'/g, "''")}'`).join(', ')})`,
  "try { $names = @($archive.Entries | ForEach-Object { $_.FullName -replace '\\\\','/' }); foreach ($name in $required) { if ($names -notcontains $name) { throw \"Release ZIP is missing $name.\" } } } finally { $archive.Dispose() }",
].join('; ');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', archiveCheck], {
  cwd: root,
  stdio: 'inherit',
});

const installerHeader = Buffer.alloc(2);
const installerHandle = await import('node:fs/promises');
const installerFile = await installerHandle.open(installerOutput, 'r');
try {
  await installerFile.read(installerHeader, 0, installerHeader.length, 0);
} finally {
  await installerFile.close();
}
if (installerHeader.toString('ascii') !== 'MZ') {
  throw new Error(`${installerName} is not a valid Windows executable.`);
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

writeFileSync(join(releasePath, checksumName), `${checksums.join('\n')}\n`, 'utf8');
console.log(`Release files created in ${releasePath}`);
