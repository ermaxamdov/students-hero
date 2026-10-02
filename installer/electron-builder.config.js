const path = require('path');
const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'StudentHero.ico');

module.exports = {
  appId: 'com.studentshero.app',
  productName: 'StudentHero',
  executableName: 'StudentHero',
  artifactName: 'StudentHero-Setup-${version}.${ext}',
  directories: {
    app: path.join(__dirname, 'app'),
    buildResources: path.join(__dirname, 'assets'),
    output: process.env.STUDENTHERO_BUILD_OUTPUT_DIR || path.join(__dirname, '..'),
  },
  extraResources: [
    { from: path.join(__dirname, '..', 'dist'), to: 'studenthero/dist' },
    { from: path.join(__dirname, '..', 'dist-server'), to: 'studenthero/dist-server' },
    {
      from: path.join(__dirname, '..', 'scripts'),
      to: 'studenthero/scripts',
      filter: ['launch-zoom-task.ps1', 'take-zoom-screenshot.ps1'],
    },
    { from: process.env.STUDENTHERO_NODE_RUNTIME_DIR || path.join(__dirname, '..', 'release', 'runtime'), to: 'studenthero/runtime' },
    { from: path.join(__dirname, '..', 'assets', 'icons', 'StudentHero.ico'), to: 'assets/StudentHero.ico' },
  ],
  files: ['**/*', '!**/*.map', '!**/.DS_Store'],
  win: {
    target: ['nsis'],
    icon: iconPath,
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: true,
    signExecutable: false,
  },
  nsis: {
    installerIcon: iconPath,
    uninstallerIcon: iconPath,
    allowElevation: false,
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
  },
};
