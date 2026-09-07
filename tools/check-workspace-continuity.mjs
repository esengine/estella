// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-workspace-continuity.mjs — a session remembers where a person
 *        was, never what a game was doing.
 *
 * Restoring a runtime fact is the failure that looks most like success: the
 * cells are plausible, the counters are real, and the editor is presenting a
 * stopped game's last frame as the state of the world. Nothing about the shape
 * of `WorkspaceState` prevents a field being added for one, so it is checked.
 *
 *   node tools/check-workspace-continuity.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const FORMAT = 'pipeline/src/project/format.ts';
const CAPTURE = 'desktop/src/project/workspaceContinuity.ts';
const SCAFFOLD = 'desktop/electron/projectScaffold.ts';

/**
 * Names that belong to a play session. A field or a capture reading one of them
 * is remembering something that ended when the game stopped.
 */
const RUNTIME_WORDS = [
  'resident', 'prepared', 'prefetch', 'loading', 'unloading', 'demandToResident',
  'residency', 'playing', 'isPlaying', 'frameCount', 'sessionId', 'entityHandle',
];

const problems = [];
const say = (file, what) => problems.push(`${file}: ${what}`);

// 1. The declared shape carries no runtime fact.
const format = read(FORMAT);
const shape = /export interface WorkspaceState \{([\s\S]*?)\n\}/.exec(format);
if (!shape) {
  say(FORMAT, 'WorkspaceState is not declared here any more — this gate guards nothing');
} else {
  for (const word of RUNTIME_WORDS) {
    // Field NAMES only — the comments there explain why these are absent, and
    // a gate reading prose would forbid saying so. The word may sit anywhere IN
    // the name: an exact match lets `residentCells` straight through.
    const field = new RegExp(`^\\s*\\w*${word}\\w*\\??:`, 'im');
    if (field.test(shape[1].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) {
      say(FORMAT, `WorkspaceState declares "${word}" — that is a play session's, not an author's`);
    }
  }
}

// 2. …and neither does what the editor puts in it. A field can be spelled
//    innocently and still be filled from the runtime.
if (existsSync(path.join(ROOT, CAPTURE))) {
  const capture = read(CAPTURE);
  const body = /export function captureWorkspace\([\s\S]*?\n\}/.exec(capture);
  if (!body) {
    say(CAPTURE, 'captureWorkspace is gone — the session is being assembled somewhere unchecked');
  } else if (/WorldRuntimeStore|readWorldResidency|PlayRealm|worldResidencyReport/.test(body[0])) {
    say(CAPTURE, 'the capture reads the running world — a restored residency is a stopped game');
  }
  // The selection has to be an authored id. A runtime handle is minted per
  // session and its index is reused, so a restored one names whatever took the
  // slot — an entity the author never selected.
  if (/runtimeFor|EngineHost\.world/.test(capture)) {
    say(CAPTURE, 'the capture reaches for runtime entity handles — selection is an AUTHORED id');
  }
}

// 3. Nothing is written until the session has been put BACK: a capture before
//    it writes a blank editor over what it was about to restore. Checked here
//    because reaching that race depends on how slowly a project opens.
const STORE = 'desktop/src/project/ProjectStore.ts';
if (existsSync(path.join(ROOT, STORE))) {
  const store = read(STORE);
  for (const fn of ['saveWorkspaceSession', 'flushWorkspaceSession']) {
    // Anchored at the DECLARATION: an unanchored name also matches the call
    // site, and the body it then reads is whatever method does the calling.
    const body = new RegExp(
      `\\n  (?:async )?${fn}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`).exec(store);
    if (!body) say(STORE, `${fn} is gone — the session is written from somewhere unchecked`);
    else if (!/workspaceRestored/.test(body[1])) {
      say(STORE, `${fn} writes without asking whether the session was restored yet`);
    }
  }
}

// 4. A project keeps its session out of source control. Without this the
//    zero-diff claim holds only for whoever wrote their own .gitignore.
if (existsSync(path.join(ROOT, SCAFFOLD))) {
  const scaffold = read(SCAFFOLD);
  const ignore = /export const PROJECT_GITIGNORE = `([\s\S]*?)`;/.exec(scaffold);
  if (!ignore) say(SCAFFOLD, 'no PROJECT_GITIGNORE — a new project would commit its workspace');
  else if (!/^\.esengine\/$/m.test(ignore[1])) {
    say(SCAFFOLD, 'PROJECT_GITIGNORE no longer ignores .esengine/ — the session would be committed');
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`check-workspace-continuity: ${problems.length} finding(s).`);
  process.exit(1);
}
console.log('check-workspace-continuity: the session remembers an author, not a play session.');
