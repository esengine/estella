// Bundles the engine's workers (the worlds' planning worker, the texture recipes' drawing worker) into the text they are started from, and writes each as a module:
//   node scripts/build-worker.mjs [--check]
// `--check` writes nothing and exits 1 when a committed text is not what its source makes now.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { workerModules } from './worker-source.mjs';

let stale = false;
for (const { path, source, bytes, entry } of await workerModules()) {
  const name = basename(path);
  if (process.argv.includes('--check')) {
    if ((existsSync(path) ? readFileSync(path, 'utf8') : '') !== source) { console.error(`${name} is not what ${entry} makes now: run node scripts/build-worker.mjs`); stale = true; }
    else console.log(`${name} is current`);
  } else {
    writeFileSync(path, source);
    console.log(`${name}: ${bytes} bytes of worker`);
  }
}
if (stale) process.exit(1);
