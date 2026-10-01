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
  files: ['**/*', '!**/*.map', '!**/.DS_Store'],
  win: {
    target: ['nsis'],
    icon: iconPath,
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: false,
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
