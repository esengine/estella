// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    miniGameWorkers.ts
 * @brief   Which of the engine's job workers a mini-game package carries, and the one worker file that carries them.
 *
 * @details A mini-game host starts a worker from a file in the package, one at a time, so the export writes a single file holding each
 *          worker the content needs (sdk/src/platform/minigame/workers.ts has the file's shape and the runtime half). A kind the content
 *          does not reach is left out: the file counts against the main package, and a game without water has no use for its baking.
 *
 *          KTX2 transcoding is not among them: its worker instantiates the basis module from bytes and imports its glue by URL, and a
 *          mini-game worker does neither. It is done on the main thread, a texture per turn of the frame's budget.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MINIGAME_WORKER_DIR, MINIGAME_WORKER_ENTRY, miniGameWorkerFile } from '../../../sdk/src/platform/minigame/workers';
import { PLAN_WORKER_SOURCE } from '../../../sdk/src/runtime/planWorkerBundle.generated';
import { RECIPE_WORKER_SOURCE } from '../../../sdk/src/image/recipeWorkerBundle.generated';
import { SOUND_WORKER_SOURCE } from '../../../sdk/src/sound/soundWorkerBundle.generated';
import { ZONE_BAKE_WORKER_SOURCE } from '../../../sdk/src/water/zoneBakeWorkerBundle.generated';
import { loadEsbuild } from '../bundle/esbuildRuntime';

/** Each worker by the name the engine's jobs ask for it (runtime/planPool.ts, image/, sound/, water/), and its script. */
const WORKER_SCRIPTS: Readonly<Record<string, string>> = {
    plan: PLAN_WORKER_SOURCE,
    image: RECIPE_WORKER_SOURCE,
    sound: SOUND_WORKER_SOURCE,
    'water-zone': ZONE_BAKE_WORKER_SOURCE,
};

/** The worker kinds the content reaches: from the subsystems its scenes use and the recipe files it ships. */
export function miniGameWorkerKinds(subsystems: Iterable<string>, includedPaths: readonly string[]): string[] {
    const used = new Set(subsystems);
    const kinds: string[] = [];
    // World planning: the placements of a WorldGen, a Foliage's cells, a planet's pages.
    if (used.has('worldgen') || used.has('foliage') || used.has('terrain')) kinds.push('plan');
    if (used.has('textureRecipe') || includedPaths.some((p) => /\.esimage$/i.test(p))) kinds.push('image');
    if (includedPaths.some((p) => /\.es(sound|music)$/i.test(p))) kinds.push('sound');
    if (used.has('water')) kinds.push('water-zone');
    return kinds;
}

/**
 * Writes `<out>/workers/index.js` carrying `kinds`, down-levelled to `esTarget` (the host compiles every script in the package against
 * its own syntax floor, this one too). Answers the path written, relative to the package.
 */
export async function writeMiniGameWorkers(outDir: string, kinds: readonly string[], esTarget: string, minify: boolean): Promise<string> {
    const scripts: Record<string, string> = {};
    for (const kind of kinds) {
        const text = WORKER_SCRIPTS[kind];
        if (text === undefined) throw new Error(`internal: no mini-game worker script named "${kind}"`);
        scripts[kind] = text;
    }
    const { transform } = await loadEsbuild();
    const { code } = await transform(miniGameWorkerFile(scripts), { loader: 'js', target: esTarget, minify, legalComments: 'none' });
    await mkdir(path.join(outDir, MINIGAME_WORKER_DIR), { recursive: true });
    await writeFile(path.join(outDir, MINIGAME_WORKER_ENTRY), code);
    return MINIGAME_WORKER_ENTRY;
}

export { MINIGAME_WORKER_DIR };
