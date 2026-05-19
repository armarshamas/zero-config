const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '1.0.0';
const platform = os.platform();
const arch = os.arch();
const target = `${platform}-${arch}`;
const SUPPORTED = ['linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64'];

if (!SUPPORTED.includes(target)) {
  console.error(`Unsupported platform: ${target}`);
  console.error(`Supported: ${SUPPORTED.join(', ')}`);
  console.error('Install the zero-config binary manually from GitHub Releases.');
  process.exit(1);
}

const url = `https://github.com/zerolang/zero-config/releases/download/v${VERSION}/zero-config-${target}`;
const binDir = path.join(__dirname, 'bin');
const dest = path.join(binDir, `zero-config-${target}`);

fs.mkdirSync(binDir, { recursive: true });

const file = fs.createWriteStream(dest);

console.log(`Downloading zero-config binary for ${target}...`);

https.get(url, (response) => {
  if (response.statusCode === 302 || response.statusCode === 301) {
    https.get(response.headers.location, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.chmodSync(dest, 0o755);
        console.log('Download complete.');
      });
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      console.error(`Error downloading binary: ${err.message}`);
      process.exit(1);
    });
  } else if (response.statusCode === 200) {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      fs.chmodSync(dest, 0o755);
      console.log('Download complete.');
    });
  } else {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    console.error(`Error: Failed to download binary. Status code: ${response.statusCode}`);
    process.exit(1);
  }
}).on('error', (err) => {
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  console.error(`Error downloading binary: ${err.message}`);
  process.exit(1);
});