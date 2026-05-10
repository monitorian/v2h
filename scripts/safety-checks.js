#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SCAN_EXT = new Set(['.js', '.cjs', '.mjs']);
const EXCLUDE_DIRS = new Set(['.git', 'node_modules']);

const ALLOWED_ECHONET_FILES = new Set([
  path.normalize('lib/common.js'),
  path.normalize('lib/control.js'),
  path.normalize('lib/discover.js'),
  path.normalize('lib/status.js'),
  path.normalize('cli.js'),
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && SCAN_EXT.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const findings = [];
for (const file of walk(ROOT)) {
  if (path.normalize(path.relative(ROOT, file)) === path.normalize('scripts/safety-checks.js')) continue;
  const rel = path.normalize(path.relative(ROOT, file));
  const text = fs.readFileSync(file, 'utf8');

  const whileTrue = /while\s*\(\s*true\s*\)/g;
  const forEver = /for\s*\(\s*;\s*;\s*\)/g;
  const lowSetInterval = /setInterval\s*\((?:.|\n|\r)*?,\s*(\d+)\s*\)/g;
  const directEchonet = /(require\(['"]echonet-lite['"]\)|from\s+['"]echonet-lite['"]|\bechonet\.sendOPC1\s*\(|\bechonet\.initialize\s*\()/g;

  let m;
  while ((m = whileTrue.exec(text))) {
    findings.push(`${rel}:${lineOf(text, m.index)} infinite loop pattern: while(true)`);
  }
  while ((m = forEver.exec(text))) {
    findings.push(`${rel}:${lineOf(text, m.index)} infinite loop pattern: for(;;)`);
  }
  while ((m = lowSetInterval.exec(text))) {
    const ms = Number(m[1]);
    if (Number.isFinite(ms) && ms < 1000) {
      findings.push(`${rel}:${lineOf(text, m.index)} setInterval below 1000ms: ${ms}`);
    }
  }

  if (!ALLOWED_ECHONET_FILES.has(rel)) {
    while ((m = directEchonet.exec(text))) {
      findings.push(`${rel}:${lineOf(text, m.index)} direct hardware API pattern outside approved wrappers`);
    }
  }
}

if (findings.length) {
  console.error('Safety pattern checks failed:\n');
  findings.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}

console.log('Safety pattern checks passed.');
