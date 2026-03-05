/**
 * @file    SceneDiscovery.ts
 * @brief   Discovers .esscene files in a project's assets directory
 */

import type { NativeFS } from '../types/NativeFS';
import { joinPath } from '../utils/path';

const SCENE_EXTENSION = '.esscene';

export async function discoverProjectScenes(
    fs: NativeFS,
    projectDir: string,
): Promise<string[]> {
    const assetsDir = joinPath(projectDir, 'assets');
    if (!await fs.exists(assetsDir)) return [];

    const scenes: string[] = [];
    await scanDirectory(fs, assetsDir, 'assets', scenes);
    scenes.sort();
    return scenes;
}

async function scanDirectory(
    fs: NativeFS,
    absDir: string,
    relDir: string,
    results: string[],
): Promise<void> {
    const entries = await fs.listDirectoryDetailed(absDir);

    for (const entry of entries) {
        const childAbs = joinPath(absDir, entry.name);
        const childRel = `${relDir}/${entry.name}`;

        if (entry.isDirectory) {
            await scanDirectory(fs, childAbs, childRel, results);
        } else if (entry.name.endsWith(SCENE_EXTENSION)) {
            results.push(childRel);
        }
    }
}
