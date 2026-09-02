// Inlines all <script src="js/*.js"> into single self-contained pages under
// dist/. Usage: node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
// The game, and the two instruments that come with it - the chronicle map
// and the asset sheet. Both are dev tools, but inlining them costs nothing
// and turns each one into something you can hand to somebody.
const PAGES = ['index.html', 'history.html', 'assets.html'];

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

for (const page of PAGES) {
  let html = fs.readFileSync(path.join(root, page), 'utf8');

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
    console.error(`ERROR: scripts not inlined in ${page}:\n  ` + leftover.join('\n  '));
    process.exit(1);
  }

  fs.writeFileSync(path.join(root, 'dist', page), html);
  console.log('dist/' + page + ' written,', (html.length / 1024).toFixed(1), 'KB,',
    inlined, 'scripts inlined');
}
