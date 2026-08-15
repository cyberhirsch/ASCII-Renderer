// Inlines all <script src="js/*.js"> into a single dist/index.html.
// Usage: node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (_, src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  return `<script>\n// ---- ${src} ----\n${code}</script>`;
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log('dist/index.html written,', (html.length / 1024).toFixed(1), 'KB');
