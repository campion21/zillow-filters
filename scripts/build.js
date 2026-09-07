#!/usr/bin/env node
/**
 * Dev-convenience build: assembles extension/manifest.json from the template
 * with the correct relative module paths, then zips dist/ for upload.
 * Usage: npm run build
 */
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Content scripts import shared/ via ../shared — inside dist, mirror the layout:
cpSync(join(ROOT, 'shared'), join(DIST, 'shared'), { recursive: true });
cpSync(join(ROOT, 'extension'), DIST, { recursive: true });

// Manifest: file is manifest.json.nobuild in the repo so nobody loads the raw
// folder (which references paths that only exist post-build).
const manifest = JSON.parse(readFileSync(join(ROOT, 'extension/manifest.json.nobuild'), 'utf8'));
writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));
rmSync(join(DIST, 'manifest.json.nobuild'), { force: true });

console.log(`Built ${DIST}`);
console.log('Load unpacked at chrome://extensions (Developer mode) or zip for CWS.');
