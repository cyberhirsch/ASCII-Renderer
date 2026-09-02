// Static verification for changes that cannot be executed in this
// environment (no GPU adapter). Checks the WGSL sources and their JS
// counterparts for the failure classes that have actually bitten this
// project: unbalanced braces from string surgery, WGSL operator-precedence
// rejections, uniform-buffer size mismatches, bind-group/binding drift,
// and JS<->WGSL constant divergence.
//
// Usage: node scripts/verify.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let failures = 0;
function fail(msg) { failures++; console.error('FAIL  ' + msg); }
function ok(msg) { console.log('  ok  ' + msg); }

const shadersSrc = fs.readFileSync(path.join(root, 'js/webgpu/shaders.js'), 'utf8');
const rendererSrc = fs.readFileSync(path.join(root, 'js/webgpu/gpu-renderer.js'), 'utf8');
const configSrc = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');

// ---- extract the WGSL template literals ----
function extractWGSL(name) {
  const re = new RegExp('const ' + name + '\\s*=\\s*/\\* wgsl \\*/`');
  const m = shadersSrc.match(re);
  if (!m) { fail(name + ': template literal not found'); return ''; }
  const start = m.index + m[0].length;
  const end = shadersSrc.indexOf('`;', start);
  if (end < 0) { fail(name + ': unterminated template'); return ''; }
  return shadersSrc.slice(start, end);
}
const wgsl = {
  WGSL_COMPUTE: extractWGSL('WGSL_COMPUTE'),
  WGSL_RENDER: extractWGSL('WGSL_RENDER'),
};

// ---- 1. brace / paren balance ----
for (const [name, src] of Object.entries(wgsl)) {
  let brace = 0, paren = 0;
  for (const ch of src) {
    if (ch === '{') brace++; else if (ch === '}') brace--;
    else if (ch === '(') paren++; else if (ch === ')') paren--;
    if (brace < 0 || paren < 0) break;
  }
  if (brace !== 0 || paren !== 0) fail(`${name}: unbalanced braces=${brace} parens=${paren}`);
  else ok(`${name}: braces/parens balanced`);
}

// ---- 2. operator-precedence (WGSL requires parens mixing &|^ with arith/shift) ----
// Does one paren-free expression mix operator classes WGSL will not rank
// for you?
function mixesOne(seg) {
  const hasShift = /<<|>>/.test(seg);
  // drop shifts, arrows and comparisons before looking for arithmetic, or
  // their < > characters read as operators
  const flat = seg.replace(/->/g, ' ').replace(/<<|>>/g, ' ')
                  .replace(/[<>]=?/g, ' ');
  const hasBit = /[&|^]/.test(flat.replace(/&&|\|\|/g, ' '));
  const hasArith = /[a-zA-Z0-9_)\]\s][*\/+%-]\s*[a-zA-Z0-9_(]/.test(flat);
  return (hasBit && hasArith) || (hasBit && hasShift) || (hasShift && hasArith);
}

// Commas separate independent expressions: a multiply in one call argument
// and an xor in the next are not a mix, so each argument is judged alone.
function mixesIn(seg) { return seg.split(',').some(mixesOne); }

// Wrapping an expression in parentheses does NOT settle the ranking inside
// it - f32(h >> 8u & 0xffffu) is still rejected - so every nesting level has
// to be examined on its own. Peel the innermost group, check it, replace it
// with a placeholder, repeat, then check what is left.
function precedenceMix(code) {
  let t = code;
  for (let guard = 0; guard < 60; guard++) {
    const m = t.match(/\(([^()]*)\)/);
    if (!m) break;
    if (mixesIn(m[1])) return true;
    t = t.replace(m[0], ' P ');
  }
  return mixesIn(t);
}

// A statement wrapped across several source lines has to be judged whole.
// Half of `hash01(a, b, seedU() ^ 0xC07Au) * 0.28` looks like a mix and is
// not one - and a checker that cries wolf is a checker people stop reading.
// So lines are accumulated until the parentheses balance, then analysed.
for (const [name, src] of Object.entries(wgsl)) {
  let bad = 0;
  let buf = '', depth = 0, startLine = 0;
  src.split('\n').forEach((ln, i) => {
    const code = ln.split('//')[0];
    if (!buf && !code.trim()) return;
    if (!buf) startLine = i + 1;
    buf += ' ' + code;
    for (const ch of code) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
    }
    if (depth > 0) return;              // the statement carries on below
    if (precedenceMix(buf)) {
      fail(`${name}:${startLine}: possible precedence mix: ${buf.trim()}`);
      bad++;
    }
    buf = '';
  });
  if (!bad) ok(`${name}: no operator-precedence mixes`);
}

// ---- 3. struct layout calculator vs JS buffer sizes ----
// WGSL uniform address space rules: f32/u32/i32 align 4 size 4, vec2 align 8
// size 8, vec3 align 16 size 12, vec4 align 16 size 16. Struct size rounds up
// to its max member alignment.
function structLayout(src, structName) {
  const m = src.match(new RegExp('struct ' + structName + '\\s*\\{([\\s\\S]*?)\\};'));
  if (!m) return null;
  const fields = [];
  for (const line of m[1].split('\n')) {
    const f = line.split('//')[0].match(/^\s*(\w+)\s*:\s*([\w<>]+)\s*,?\s*$/);
    if (f) fields.push([f[1], f[2]]);
  }
  const dims = { f32: [4, 4], u32: [4, 4], i32: [4, 4],
    vec2f: [8, 8], 'vec2<f32>': [8, 8], vec2u: [8, 8], vec2i: [8, 8],
    vec3f: [16, 12], 'vec3<f32>': [16, 12],
    vec4f: [16, 16], 'vec4<f32>': [16, 16] };
  let off = 0, maxA = 4;
  const offsets = {};
  for (const [fname, ftype] of fields) {
    const d = dims[ftype];
    if (!d) return { error: `${structName}.${fname}: unknown type ${ftype}` };
    off = Math.ceil(off / d[0]) * d[0];
    offsets[fname] = off;
    off += d[1];
    maxA = Math.max(maxA, d[0]);
  }
  return { size: Math.ceil(off / maxA) * maxA, offsets, fields };
}

// Declared expectations, updated as the project grows. Each entry:
// struct in which WGSL module, and the byte size the JS side allocates.
function jsNumber(re, src, what) {
  const m = src.match(re);
  if (!m) { fail(`${what}: pattern not found in JS`); return -1; }
  return parseInt(m[1], 10);
}
const uniSize = jsNumber(/uniBuf = device\.createBuffer\(\{\s*\n?\s*size:\s*(\d+)/, rendererSrc, 'uniBuf size');
const rparSize = jsNumber(/rparBuf = device\.createBuffer\(\{\s*\n?\s*size:\s*(\d+)/, rendererSrc, 'rparBuf size');
const uniFloats = jsNumber(/const u = new Float32Array\((\d+)\)/, rendererSrc, 'uniform Float32Array');

const uni = structLayout(wgsl.WGSL_COMPUTE, 'Uniforms');
if (!uni || uni.error) fail('Uniforms layout: ' + (uni ? uni.error : 'struct missing'));
else if (uni.size !== uniSize) fail(`Uniforms WGSL size ${uni.size} != JS uniBuf ${uniSize}`);
else if (uniFloats * 4 !== uniSize) fail(`uniform Float32Array ${uniFloats * 4}B != uniBuf ${uniSize}B`);
else ok(`Uniforms: WGSL ${uni.size}B == uniBuf ${uniSize}B == Float32Array ${uniFloats * 4}B`);

const rpar = structLayout(wgsl.WGSL_RENDER, 'RParams');
if (!rpar || rpar.error) fail('RParams layout: ' + (rpar ? rpar.error : 'struct missing'));
else if (rpar.size !== rparSize) fail(`RParams WGSL size ${rpar.size} != JS rparBuf ${rparSize}`);
else ok(`RParams: WGSL ${rpar.size}B == rparBuf ${rparSize}B`);

// ---- 4. binding declarations vs bind-group entries ----
function bindingsIn(src) {
  return [...src.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map(m => +m[1]).sort((a, b) => a - b);
}
function entriesIn(src, groupVar) {
  const m = src.match(new RegExp(groupVar + '[\\s\\S]*?entries:\\s*\\[([\\s\\S]*?)\\]\\s*,?\\s*\\}\\)'));
  if (!m) return null;
  return [...m[1].matchAll(/binding:\s*(\d+)/g)].map(x => +x[1]).sort((a, b) => a - b);
}
const compDecl = bindingsIn(wgsl.WGSL_COMPUTE);
const compEnt = entriesIn(rendererSrc, 'computeBind = this\\.device\\.createBindGroup');
const rendDecl = bindingsIn(wgsl.WGSL_RENDER);
const rendEnt = entriesIn(rendererSrc, 'renderBind = this\\.device\\.createBindGroup');
function cmp(name, decl, ent) {
  if (!ent) { fail(name + ': bind group entries not found'); return; }
  if (JSON.stringify(decl) !== JSON.stringify(ent))
    fail(`${name}: WGSL bindings [${decl}] != JS entries [${ent}]`);
  else ok(`${name}: bindings match [${decl}]`);
}
cmp('compute', compDecl, compEnt);
cmp('render', rendDecl, rendEnt);

// ---- 4b. shared JS<->WGSL constants ----
// Convention: every CAVE_*/EDIT_* const in the WGSL source must be an
// interpolation from the JS side (${CFG.X} or ${CAVES.X}), never a literal —
// a literal is exactly how the shader and the CPU mirrors would drift apart.
// And every such interpolation must resolve to a key that actually exists.
{
  const utilSrc = fs.readFileSync(path.join(root, 'js/util.js'), 'utf8');
  let bad = 0, interps = 0, decls = 0;
  for (const m of shadersSrc.matchAll(/\$\{(CFG|CAVES|MATS|TERR|TREE|PROPS)\.(\w+)[^}]*\}/g)) {
    interps++;
    const home = m[1] === 'CFG' ? configSrc : utilSrc;
    if (!new RegExp('\\b' + m[2] + '\\s*:').test(home)) {
      fail(`WGSL interpolation \${${m[1]}.${m[2]}}: key not defined in ${m[1] === 'CFG' ? 'js/config.js' : 'js/util.js'}`);
      bad++;
    }
  }
  for (const m of shadersSrc.matchAll(/const\s+((?:CAVE|EDIT|MAT)_\w+)\s*(?::\s*\w+)?\s*=\s*([^;]+);/g)) {
    decls++;
    if (!/\$\{/.test(m[2])) {
      fail(`WGSL const ${m[1]} is a literal (${m[2].trim()}) — interpolate from CFG/CAVES`);
      bad++;
    }
  }
  if (!bad) ok(`shared consts: ${decls} CAVE_/EDIT_/MAT_ consts, ${interps} interpolations resolve`);
}

// ---- 4c. no magic numbers in the functions the CPU also implements ----
// The const rule above only reaches declared WGSL consts, and the worst
// divergence this project can have is not in a named constant at all: it is
// a retyped float inside terrainH or treeAt. Those two decide where the
// ground is and where the trees stand, on both sides, and a slip in either
// moves the world out from under collision without changing a pixel that
// looks wrong. So they may hold no bare float literal beyond the handful
// that are structure rather than tuning — 0.5 to centre a value-noise
// sample, 1.0 and 2.0 in the arithmetic itself.
{
  const NEUTRAL = new Set(['0.0', '0.5', '1.0', '2.0', '3.0']);
  const src = wgsl.WGSL_COMPUTE;
  let bad = 0, checked = 0;
  for (const fn of ['terrainH', 'treeAt']) {
    const m = src.match(new RegExp('\\nfn ' + fn + '\\s*\\([^)]*\\)[^{]*\\{'));
    if (!m) { fail(`4c: fn ${fn} not found in WGSL_COMPUTE`); bad++; continue; }
    let i = m.index + m[0].length, depth = 1;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    // strip comments and interpolations; whatever floats are left are raw
    const body = src.slice(m.index + m[0].length, i)
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/\$\{[^}]*\}/g, ' ');
    const lits = (body.match(/\d+\.\d+/g) || []).filter(v => !NEUTRAL.has(v));
    checked++;
    if (lits.length) {
      fail(`${fn}: bare literal(s) ${[...new Set(lits)].join(', ')} — ` +
           'hoist into TERR/TREE in js/util.js and interpolate');
      bad++;
    }
  }
  if (!bad) ok(`mirrored fns: ${checked} carry no retyped constants`);
}

// ---- 5. all modules parse ----
const vm = require('vm');
const modules = ['config', 'quality', 'util', 'world', 'sky', 'overlay',
  'entities', 'edits', 'removed', 'chronicle', 'assets', 'steading', 'lore',
  'items', 'game', 'player',
  'webgpu/atlas', 'webgpu/shaders', 'webgpu/gpu-renderer', 'main'];
for (const f of modules) {
  const p = path.join(root, 'js', f + '.js');
  if (!fs.existsSync(p)) { fail(`module missing: js/${f}.js`); continue; }
  try { new vm.Script(fs.readFileSync(p, 'utf8'), { filename: f }); }
  catch (e) { fail(`syntax error in js/${f}.js: ${e.message}`); }
}
ok('all modules parse');

// ---- result ----
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
