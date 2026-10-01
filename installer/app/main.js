const { app, BrowserWindow, ipcMain } = require('electron');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const net = require('net');

const APP_NAME = 'StudentHero';
const DEFAULT_WORKER_PORT = 8787;
const DEFAULT_LOCAL_PORT = 5173;
const REPO_URL = 'https://github.com/sardor1411/students-hero';
const RELEASE_API_URL = 'https://api.github.com/repos/sardor1411/students-hero/releases/latest';
const INSTALL_ROOT = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'StudentsHero');
const LOG_PATH = path.join(INSTALL_ROOT, 'logs', 'setup.log');

let installerWindow = null;
let appWindow = null;
let activeProcesses = [];
let retryHandler = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    ensureDir(path.dirname(LOG_PATH));
    fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Could not write setup log:', error);
  }
}

function setStatus(statusText, percent = 0, detail = '') {
  if (!installerWindow || installerWindow.isDestroyed()) return;
  installerWindow.webContents.send('set-status', { statusText, percent, detail });
}

function setError(message) {
  if (!installerWindow || installerWindow.isDestroyed()) return;
  installerWindow.webContents.send('set-error', { message });
}

function getRuntimeDir() {
  return path.join(INSTALL_ROOT, 'runtime');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function getNodeBinDir() {
  const runtimeDir = getRuntimeDir();
  const candidateDirs = [
    path.join(runtimeDir, 'node-v20.19.0-win-x64'),
    runtimeDir,
  ];

  for (const dir of candidateDirs) {
    const node = path.join(dir, 'node.exe');
    if (fs.existsSync(node)) {
      return dir;
    }
  }
  return runtimeDir;
}

function getNpmCliPath(nodeDir) {
  const npmCliPath = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCliPath)) {
    throw new Error(`npm CLI was not found in the portable Node runtime: ${npmCliPath}`);
  }
  return npmCliPath;
}

function getStateFile() {
  return path.join(INSTALL_ROOT, '.setup-state.json');
}

function saveState(state) {
  ensureDir(INSTALL_ROOT);
  fs.writeFileSync(getStateFile(), JSON.stringify(state, null, 2), 'utf8');
}

function loadState() {
  try {
    if (!fs.existsSync(getStateFile())) return {};
    return JSON.parse(fs.readFileSync(getStateFile(), 'utf8'));
  } catch (error) {
    logLine(`State read failed: ${error.message}`);
    return {};
  }
}

function terminateProcessTree(child) {
  if (!child || !child.pid) return;

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
      logLine(`taskkill failed for ${child.pid}: ${error.message}`);
    }
  } else if (child.kill) {
    child.kill('SIGTERM');
  }
}

function killAppProcesses() {
  for (const child of activeProcesses) {
    terminateProcessTree(child);
  }
  activeProcesses = [];
}

function chooseFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.unref();
      server.on('error', () => {
        const next = port + 1;
        if (next > startPort + 32) {
          reject(new Error(`No free port found starting at ${startPort}.`));
          return;
        }
        tryPort(next);
      });
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port));
      });
    };
    tryPort(startPort);
  });
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const request = client.get(url, (response) => {
          response.resume();
          resolve();
        });
        request.on('error', reject);
        request.setTimeout(2500, () => request.destroy(new Error('HTTP timeout')));
      });
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Timed out while waiting for ${url}`);
}

async function waitForLocalServer(url, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status === 404) return;
    } catch (error) {
      // Keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out while waiting for ${url}`);
}

function downloadFile(url, targetPath, onProgress) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(targetPath));
    const file = fs.createWriteStream(targetPath);
    const request = https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        const nextUrl = response.headers.location;
        if (!nextUrl) {
          reject(new Error(`Download redirect missing location for ${url}`));
          return;
        }
        file.close();
        fs.unlink(targetPath, () => {});
        resolve(downloadFile(nextUrl, targetPath, onProgress));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} while downloading ${url}`));
        return;
      }

      const totalSize = Number(response.headers['content-length'] || 0);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          onProgress(Math.min(100, Math.round((downloaded / totalSize) * 100)));
        }
      });

      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });

    request.on('error', (error) => {
      fs.unlink(targetPath, () => {});
      reject(error);
    });
    file.on('error', (error) => {
      fs.unlink(targetPath, () => {});
      reject(error);
    });
  });
}

function extractZip(archivePath, destination) {
  return new Promise((resolve, reject) => {
    ensureDir(destination);
    const powershellArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
    ];

    const child = spawn('powershell.exe', powershellArgs, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Archive extraction failed: ${stderr || 'unknown error'}`));
      }
    });
  });
}

async function resolveLatestRelease() {
  return await new Promise((resolve, reject) => {
    const request = https.get(
      RELEASE_API_URL,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `StudentHero/${app.getVersion()}`,
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub latest release request failed with HTTP ${response.statusCode}.`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          let release;
          try {
            release = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch (error) {
            reject(new Error(`GitHub returned invalid release metadata: ${error.message}`));
            return;
          }

          const tagName = release && release.tag_name;
          if (typeof tagName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tagName)) {
            reject(new Error('GitHub latest release metadata did not contain a valid tag name.'));
            return;
          }

          resolve({
            tagName,
            zipUrl: `${REPO_URL}/archive/refs/tags/${encodeURIComponent(tagName)}.zip`,
          });
        });
      },
    );

    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('GitHub latest release request timed out.')));
  });
}

function copyDirectory(sourceDir, targetDir, preserveList) {
  ensureDir(targetDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (preserveList.has(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!fs.existsSync(targetPath)) {
        ensureDir(targetPath);
      }
      copyDirectory(sourcePath, targetPath, preserveList);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

async function ensureAppFiles() {
  const preserveNames = new Set(['.env', '.env.local', 'data', 'uploads', 'storage', 'logs', 'runtime', 'node_modules']);
  const state = loadState();
  const packageJsonPath = path.join(INSTALL_ROOT, 'package.json');
  const nodeModulesPath = path.join(INSTALL_ROOT, 'node_modules');
  const hasInstalledProject = fs.existsSync(packageJsonPath);
  const hasInstalledDependencies = fs.existsSync(nodeModulesPath);

  if (
    hasInstalledProject
    && hasInstalledDependencies
    && state.releaseTag
    && Number.isFinite(Date.parse(state.releaseCheckedAt))
    && Date.now() - Date.parse(state.releaseCheckedAt) < 6 * 60 * 60 * 1000
  ) {
    logLine(`Using recently checked release ${state.releaseTag}.`);
    return;
  }

  let release;

  try {
    release = await resolveLatestRelease();
  } catch (error) {
    if (hasInstalledProject && hasInstalledDependencies) {
      const installedRelease = state.releaseTag || 'the existing installation';
      logLine(`Latest release check failed; continuing with ${installedRelease}: ${error.message}`);
      setStatus('Offline mode', 100, `Using ${installedRelease}`);
      return;
    }
    throw error;
  }

  if (hasInstalledProject && state.releaseTag === release.tagName && hasInstalledDependencies) {
    saveState({ ...state, releaseCheckedAt: new Date().toISOString() });
    logLine(`Release ${release.tagName} is already installed; skipping source download.`);
    return;
  }

  const tempRoot = path.join(INSTALL_ROOT, 'tmp-download');
  ensureDir(tempRoot);

  const zipPath = path.join(tempRoot, 'studenthero.zip');
  setStatus('Downloading...', 3, `StudentHero ${release.tagName}`);
  logLine(`Downloading StudentHero release ${release.tagName} from ${release.zipUrl}`);
  await downloadFile(release.zipUrl, zipPath, (percent) => setStatus('Downloading...', percent, `Release ${release.tagName}`));

  const extractDir = path.join(tempRoot, 'archive');
  ensureDir(extractDir);
  await extractZip(zipPath, extractDir);

  const extractedEntries = fs.readdirSync(extractDir);
  const archiveSource = extractedEntries.length === 1 && fs.statSync(path.join(extractDir, extractedEntries[0])).isDirectory()
    ? path.join(extractDir, extractedEntries[0])
    : extractDir;

  if (!hasInstalledProject) {
    setStatus('Creating folder...', 25);
    ensureDir(INSTALL_ROOT);
    copyDirectory(archiveSource, INSTALL_ROOT, preserveNames);
    const now = new Date().toISOString();
    saveState({ ...state, releaseTag: release.tagName, releaseCheckedAt: now, lastUpdated: now });
    return;
  }

  copyDirectory(archiveSource, INSTALL_ROOT, preserveNames);
  const now = new Date().toISOString();
  saveState({ ...state, releaseTag: release.tagName, releaseCheckedAt: now, lastUpdated: now });
}

async function ensureNodeRuntime() {
  const nodeVersion = '20.19.0';
  const runtimeDir = getRuntimeDir();
  const nodeDir = getNodeBinDir();
  const nodeExecutable = path.join(nodeDir, 'node.exe');

  if (fs.existsSync(nodeExecutable)) {
    const installedVersion = execFileSync(nodeExecutable, ['--version'], { encoding: 'utf8' }).trim();
    if (installedVersion === `v${nodeVersion}`) {
      logLine(`Using Node runtime ${installedVersion} at ${nodeDir}`);
      return nodeDir;
    }
    logLine(`Replacing incompatible Node runtime ${installedVersion} with v${nodeVersion}.`);
  }

  const nodeZip = path.join(runtimeDir, `node-v${nodeVersion}-win-x64.zip`);
  const zipUrl = `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`;
  ensureDir(runtimeDir);
  setStatus('Downloading runtime...', 40, 'Portable Node.js');
  await downloadFile(zipUrl, nodeZip, (percent) => setStatus('Downloading runtime...', 40 + Math.round(percent * 0.35), 'Portable Node.js'));
  await extractZip(nodeZip, runtimeDir);

  const actualNodeDir = getNodeBinDir();
  const actualNode = path.join(actualNodeDir, 'node.exe');
  if (!fs.existsSync(actualNode) || execFileSync(actualNode, ['--version'], { encoding: 'utf8' }).trim() !== `v${nodeVersion}`) {
    throw new Error('Portable Node runtime did not extract successfully.');
  }
  return actualNodeDir;
}

async function runCommand(command, args, cwd, extraEnv = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      shell: false,
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output || `Command failed with code ${code}`));
      }
    });
  });
}

async function installDependencies() {
  const state = loadState();
  const packageJsonPath = path.join(INSTALL_ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('The project files were not installed into the StudentsHero folder.');
  }

  const lockFilePath = path.join(INSTALL_ROOT, 'package-lock.json');
  if (!fs.existsSync(lockFilePath)) {
    throw new Error('The project dependency lockfile is missing from the installation.');
  }

  const dependencyHash = crypto.createHash('sha256')
    .update(fs.readFileSync(packageJsonPath))
    .update(fs.readFileSync(lockFilePath))
    .digest('hex');
  const previousHash = state.dependencyHash || null;
  const nodeModulesDir = path.join(INSTALL_ROOT, 'node_modules');

  if (fs.existsSync(nodeModulesDir) && previousHash === dependencyHash) {
    logLine('Skipping npm ci because the dependency manifests did not change.');
    return;
  }

  const nodeDir = await ensureNodeRuntime();
  const pathWithNode = `${nodeDir};${process.env.PATH || ''}`;
  const nodeExecutable = path.join(nodeDir, 'node.exe');
  const npmCliPath = getNpmCliPath(nodeDir);

  setStatus('Installing dependencies...', 60);
  logLine(`Running npm ci in ${INSTALL_ROOT}`);
  try {
    await runCommand(nodeExecutable, [npmCliPath, 'ci', '--no-fund', '--no-audit'], INSTALL_ROOT, { PATH: pathWithNode });
    saveState({ ...state, dependencyHash, lastUpdated: new Date().toISOString() });
  } catch (error) {
    throw new Error(`npm install failed: ${error.message}`);
  }
}

async function findOpenPort(startPort, fallbackStart) {
  const chosen = await chooseFreePort(startPort);
  return chosen;
}

function startBackgroundCommand(command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeProcesses.push(child);

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    logLine(`[${command}] ${text.trim()}`);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    logLine(`[${command}] ${text.trim()}`);
  });

  child.on('exit', (code, signal) => {
    logLine(`${command} exited with code=${code} signal=${signal || 'none'}`);
    activeProcesses = activeProcesses.filter((proc) => proc !== child);
  });
  return child;
}

async function startInstalledApp() {
  const workerPort = await findOpenPort(DEFAULT_WORKER_PORT, DEFAULT_WORKER_PORT + 10);
  const localPort = await findOpenPort(DEFAULT_LOCAL_PORT, DEFAULT_LOCAL_PORT + 10);
  const nodeDir = getNodeBinDir();
  const nodeExecutable = path.join(nodeDir, 'node.exe');
  const npmCliPath = getNpmCliPath(nodeDir);
  const extraEnv = {
    PATH: `${nodeDir};${process.env.PATH || ''}`,
    ELMS_API_PORT: String(workerPort),
  };

  setStatus('Starting...', 80, `Worker on ${workerPort}, app on ${localPort}`);
  const workerProc = startBackgroundCommand(nodeExecutable, [npmCliPath, 'run', 'worker'], INSTALL_ROOT, extraEnv);
  await waitForHttp(`http://127.0.0.1:${workerPort}/health`, 90_000);

  const localProc = startBackgroundCommand(nodeExecutable, [npmCliPath, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(localPort)], INSTALL_ROOT, extraEnv);
  await waitForLocalServer(`http://127.0.0.1:${localPort}`, 90_000);

  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.close();
  }

  appWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 840,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'StudentHero.ico'),
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  appWindow.setMenuBarVisibility(false);
  appWindow.setTitle(APP_NAME);
  appWindow.loadURL(`http://127.0.0.1:${localPort}`);
  appWindow.on('closed', () => {
    appWindow = null;
    killAppProcesses();
    app.quit();
  });

  setStatus('Starting...', 100, 'Ready');
  logLine(`StudentsHero is running on http://127.0.0.1:${localPort}`);
}

async function bootstrap() {
  try {
    ensureDir(INSTALL_ROOT);
    ensureDir(path.join(INSTALL_ROOT, 'logs'));
    setStatus('Creating folder...', 10);
    await ensureAppFiles();
    await installDependencies();
    await startInstalledApp();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    logLine(`Bootstrap failed: ${message}`);
    setError(message);
  }
}

function createInstallerWindow() {
  installerWindow = new BrowserWindow({
    width: 500,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'StudentsHero Setup',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'StudentHero.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  installerWindow.setMenuBarVisibility(false);
  installerWindow.loadFile(path.join(__dirname, 'index.html'));
  installerWindow.once('ready-to-show', () => installerWindow.show());
  installerWindow.on('closed', () => {
    installerWindow = null;
  });
}

ipcMain.on('retry-setup', () => {
  if (installerWindow) {
    installerWindow.webContents.send('set-error', { message: '' });
  }
  bootstrap();
});

app.on('second-instance', () => {
  if (installerWindow) {
    if (installerWindow.isMinimized()) installerWindow.restore();
    installerWindow.focus();
  }
  if (appWindow) {
    if (appWindow.isMinimized()) appWindow.restore();
    appWindow.focus();
  }
});

app.on('ready', () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  createInstallerWindow();
  bootstrap();
});

app.on('before-quit', () => {
  killAppProcesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
