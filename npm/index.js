#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

const platform = os.platform();
const arch = os.arch();
const binaryName = `zero-config-${platform}-${arch}`;
const binaryPath = path.join(__dirname, 'bin', binaryName);

try {
  execFileSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
} catch (e) {
  if (e.code === 'ENOENT') {
    console.error(`Error: zero-config binary not found at ${binaryPath}`);
    console.error('Please run "npm install" or install the binary manually.');
    process.exit(1);
  }
  process.exit(e.status || 1);
}