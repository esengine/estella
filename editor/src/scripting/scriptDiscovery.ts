/**
 * @file    scriptDiscovery.ts
 * @brief   Discover TypeScript files in a project's src directory
 */

import { joinPath } from '../utils/path';

const IGNORED_SCRIPT_DIRS = new Set(['node_modules', 'dist', 'build']);
const EDITOR_ONLY_DIRS = new Set(['editor']);

interface DirListable {
    listDirectoryDetailed(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
}

async function findTsFiles(
    fs: DirListable,
    dir: string,
    excludeDirs?: Set<string>,
): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.listDirectoryDetailed(dir);
    for (const e of entries) {
        if (e.isDirectory) {
            if (!IGNORED_SCRIPT_DIRS.has(e.name) && !e.name.startsWith('.')
                && !(excludeDirs?.has(e.name))) {
                results.push(...await findTsFiles(fs, joinPath(dir, e.name), excludeDirs));
            }
        } else if (e.name.endsWith('.ts')) {
            results.push(joinPath(dir, e.name));
        }
    }
    return results;
}

export { findTsFiles, IGNORED_SCRIPT_DIRS, EDITOR_ONLY_DIRS };
