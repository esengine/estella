// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  liteEngine.ts — whether a mini-game package can carry the engine without the subsystems it never uses.
 *
 * The engine core compiles particles, post-processing and tilemaps in or out (`ES_ENABLE_*`), and a package whose content
 * uses none of them does not need the ~200 KB they cost against a 4 MB main package. The evidence is the one the lean SDK
 * entry is chosen by — the components its scenes and prefabs carry — plus the project's own scripts, because a script can
 * add an emitter or a volume to a world no scene mentioned. A guess that said "unused" would be a particle effect that
 * silently never draws, so every doubt answers "carry them".
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Subsystem } from '../project/targetSupport';
import type { ModuleChoice } from '../project/format';

/** The subsystems the lite engine is built without. */
export const LITE_OMITS: readonly Subsystem[] = ['particles', 'postprocess', 'tilemap'];

/** What a script says when it uses one of them. Broad on purpose: a comment that names one only costs the saving. */
const SCRIPT_MENTIONS = /\b(ParticleEmitter|ParticleForceField|ParticleCollider|Particle|ParticlePlugin|PostProcess\w*|Tilemap\w*|TilemapLayer|Tilemaps)\b|esengine\/tilemap/;

const SCRIPT_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.esengine', 'dist', 'build', 'out']);
const MAX_FILES = 4000;

/**
 * What a script says when it uses the animator graph or a grip pose. Those names are exported from `esengine` itself, not
 * only from the subpath that installs them, so a script that reaches one by name leaves no import to read. `SpriteAnimator`
 * does not match: the boundary sits before `Animator`, not inside a longer name.
 */
const SKELETAL_MENTIONS = /\b(Animator\w*|Grip[A-Z]\w*|registerAnimatorController|getRegisteredAnimatorController|solveAnimatorIK|parseAvatar|emptyAvatar|avatarResolver|MotionRegistry|motionOf|blend[12]DMotionDriver)\b|esengine\/skeletal-animation/;

/** Whether any of the project's script sources mentions a subsystem the lite engine leaves out. */
export function scriptsMentionOmitted(root: string, scriptsEntry?: string): Promise<boolean> {
  return scriptsMatch(root, scriptsEntry, SCRIPT_MENTIONS);
}

/** Whether any of the project's script sources names the animator graph or a grip pose. */
export function scriptsMentionSkeletal(root: string, scriptsEntry?: string): Promise<boolean> {
  return scriptsMatch(root, scriptsEntry, SKELETAL_MENTIONS);
}

async function scriptsMatch(root: string, scriptsEntry: string | undefined, pattern: RegExp): Promise<boolean> {
  let seen = 0;
  const walk = async (dir: string): Promise<boolean> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (await walk(path.join(dir, e.name))) return true;
      } else if (SCRIPT_EXT.test(e.name) && !e.name.endsWith('.d.ts')) {
        if (++seen > MAX_FILES) return true;  // too many to say: carry everything
        try {
          if (pattern.test(await readFile(path.join(dir, e.name), 'utf8'))) return true;
        } catch { return true; }
      }
    }
    return false;
  };
  if (await walk(path.join(root, 'src'))) return true;
  if (scriptsEntry) {
    const entryDir = path.dirname(path.join(root, scriptsEntry));
    if (path.resolve(entryDir) !== path.resolve(root, 'src') && await walk(entryDir)) return true;
  }
  return false;
}

/**
 * Whether this package takes the lite engine. Carries everything when any scene or prefab uses an omitted subsystem, when a
 * script mentions one, or when the project asked for tilemaps by name.
 */
export function liteEngineAnswer(evidence: {
  subsystems: Iterable<Subsystem>;
  scriptsMention: boolean;
  choices?: Readonly<Record<string, ModuleChoice>>;
}): boolean {
  if (evidence.scriptsMention) return false;
  if (evidence.choices?.['esengine/tilemap'] === 'include') return false;
  const used = new Set(evidence.subsystems);
  return !LITE_OMITS.some((s) => used.has(s));
}
