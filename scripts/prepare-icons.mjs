import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const logoSource = path.join(root, 'students-hero-app.png');
const iconDir = path.join(root, 'assets', 'icons');
const iconPath = path.join(iconDir, 'StudentHero.ico');
const installerIconPath = path.join(root, 'installer', 'assets', 'StudentHero.ico');
const legacyInstallerIconPath = path.join(root, 'installer', 'assets', 'studenthero.ico');

if (!existsSync(logoSource)) {
  throw new Error(`Source logo not found: ${logoSource}`);
}

mkdirSync(iconDir, { recursive: true });

const script = [
  'import io',
  'import struct',
  'import sys',
  'from PIL import Image',
  'src = sys.argv[1]',
  'out = sys.argv[2]',
  'img = Image.open(src).convert("RGBA")',
  'sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]',
  'parts = []',
  'offset = 6 + len(sizes) * 16',
  'for size in sizes:',
  '    buf = io.BytesIO()',
  '    img.resize((size, size), Image.Resampling.LANCZOS).save(buf, format="PNG")',
  '    payload = buf.getvalue()',
  '    parts.append((size, payload, offset))',
  '    offset += len(payload)',
  'with open(out, "wb") as f:',
  '    f.write(struct.pack("<HHH", 0, 1, len(sizes)))',
  '    for size, payload, entry_offset in parts:',
  '        width = 0 if size == 256 else size',
  '        f.write(struct.pack("<BBBBHHII", width, width, 0, 0, 1, 32, len(payload), entry_offset))',
  '    for size, payload, entry_offset in parts:',
  '        f.write(payload)',
].join('\n');

const result = spawnSync('python', ['-c', script, logoSource, iconPath], { stdio: 'inherit' });

if (result.status !== 0) {
  throw new Error(`Failed to convert ${logoSource} into ${iconPath}`);
}

mkdirSync(path.dirname(installerIconPath), { recursive: true });
copyFileSync(iconPath, installerIconPath);
copyFileSync(iconPath, legacyInstallerIconPath);

console.log(`StudentsHero icon generated at ${iconPath}`);
console.log(`Installer icon copy written to ${installerIconPath}`);
console.log(`Legacy compatibility copy written to ${legacyInstallerIconPath}`);
