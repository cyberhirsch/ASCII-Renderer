// Inlines all <script src="js/*.js"> into a single dist/index.html.
// Usage: node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// note: the path charset must allow '/' so scripts in subdirectories
// (js/webgpu/*.js) are inlined too, not left as dead relative links
let inlined = 0;
html = html.replace(/<script src="(js\/[\w./-]+\.js)"><\/script>/g, (_, src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  inlined++;
  return `<script>\n// ---- ${src} ----\n${code}</script>`;
});

// fail loudly rather than shipping a bundle with unresolved <script src>
const leftover = html.match(/<script src="[^"]+"><\/script>/g);
if (leftover) {
  console.error('ERROR: scripts not inlined:\n  ' + leftover.join('\n  '));
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log('dist/index.html written,', (html.length / 1024).toFixed(1), 'KB,',
  inlined, 'scripts inlined');
