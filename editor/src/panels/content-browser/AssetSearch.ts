import { joinPath } from '../../utils/path';
import { fuzzyMatch } from '../../utils/fuzzy';
import type { AssetItem } from './ContentBrowserTypes';
import { getNativeFS, getAssetType, SEARCH_RESULTS_LIMIT } from './ContentBrowserTypes';

export async function searchRecursive(basePath: string, filter: string): Promise<AssetItem[]> {
    const fs = getNativeFS();
    if (!fs || !basePath) return [];

    const scored: Array<{ item: AssetItem; score: number }> = [];
    const stack = [basePath];

    while (stack.length > 0 && scored.length < SEARCH_RESULTS_LIMIT * 2) {
        const dir = stack.pop()!;
        try {
            const entries = await fs.listDirectoryDetailed(dir);
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name.endsWith('.meta')) continue;

                const entryPath = joinPath(dir, entry.name);

                if (entry.isDirectory) {
                    stack.push(entryPath);
                    const match = fuzzyMatch(filter, entry.name);
                    if (match) {
                        const relative = entryPath.substring(basePath.length).replace(/^\//, '');
                        scored.push({
                            item: { name: entry.name, path: entryPath, type: 'folder', relativePath: relative },
                            score: match.score,
                        });
                    }
                } else {
                    const match = fuzzyMatch(filter, entry.name);
                    if (match) {
                        const relative = entryPath.substring(basePath.length).replace(/^\//, '');
                        scored.push({
                            item: { name: entry.name, path: entryPath, type: getAssetType(entry), relativePath: relative },
                            score: match.score,
                        });
                    }
                }
            }
        } catch {
            // skip inaccessible directories
        }
    }

    return scored
        .sort((a, b) => {
            if (a.item.type === 'folder' && b.item.type !== 'folder') return -1;
            if (a.item.type !== 'folder' && b.item.type === 'folder') return 1;
            return b.score - a.score;
        })
        .map(s => s.item);
}
