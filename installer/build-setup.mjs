import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const configPath = join(root, 'installer', 'electron-builder.config.cjs');
const setupOutput = join(root, 'setup.exe');
const buildOutput = join(root, 'release', 'build');
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const installerPackage = JSON.parse(readFileSync(join(root, 'installer', 'app', 'package.json'), 'utf8'));

if (rootPackage.version !== installerPackage.version) {
  throw new Error('Root and installer package versions must match before building a release.');
}

const builtArtifact = join(buildOutput, `StudentHero-Setup-${installerPackage.version}.exe`);

if (!existsSync(configPath)) {
  throw new Error(`Missing builder config: ${configPath}`);
}

const cliPath = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const args = ['--config', configPath, '--win', '--x64'];

rmSync(buildOutput, { recursive: true, force: true });
mkdirSync(buildOutput, { recursive: true });

console.log('Building StudentHero installer...');
execFileSync(process.execPath, [cliPath, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    FORCE_COLOR: '0',
    STUDENTHERO_BUILD_OUTPUT_DIR: buildOutput,
  },
});

if (!existsSync(builtArtifact)) {
  throw new Error(`Expected installer was not created: ${builtArtifact}`);
}

if (!existsSync(join(buildOutput, 'win-unpacked'))) {
  throw new Error(`Electron app output was not created under ${buildOutput}`);
}

copyFileSync(builtArtifact, setupOutput);
console.log(`Copied installer to ${setupOutput}`);
