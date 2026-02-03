const fs = require('fs');
const path = require('path');

// Simple bundle creation script
console.log('Creating JavaScript bundle...');

const bundleContent = `
// Trinity App Bundle - Generated ${new Date().toISOString()}
require('./index.ts');
`;

const assetsDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'assets');
const bundlePath = path.join(assetsDir, 'index.android.bundle');

// Ensure assets directory exists
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Create a simple bundle
fs.writeFileSync(bundlePath, bundleContent);

console.log('Bundle created at:', bundlePath);
console.log('Bundle size:', fs.statSync(bundlePath).size, 'bytes');