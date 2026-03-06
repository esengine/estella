import type { NativeFS, DirectoryEntry } from '../types/NativeFS';
import { joinPath } from '../utils/path';

export interface DiscoveredPlugin {
    packageName: string;
    entryPath: string;
    displayName?: string;
    version?: string;
    description?: string;
}

const SKIP_PACKAGES = new Set(['esengine', '@esengine/editor']);

export async function discoverPluginPackages(
    fs: NativeFS,
    projectDir: string,
    entry: 'main' | 'editor',
): Promise<DiscoveredPlugin[]> {
    const nodeModulesPath = joinPath(projectDir, 'node_modules');
    if (!await fs.exists(nodeModulesPath)) return [];

    const results: DiscoveredPlugin[] = [];

    let entries: DirectoryEntry[];
    try {
        entries = await fs.listDirectoryDetailed(nodeModulesPath);
    } catch {
        return [];
    }

    for (const e of entries) {
        if (!e.isDirectory) continue;

        if (e.name.startsWith('@')) {
            let scopeEntries: DirectoryEntry[];
            try {
                scopeEntries = await fs.listDirectoryDetailed(joinPath(nodeModulesPath, e.name));
            } catch {
                continue;
            }
            for (const se of scopeEntries) {
                if (!se.isDirectory) continue;
                const pkgName = `${e.name}/${se.name}`;
                const plugin = await checkPackage(fs, nodeModulesPath, pkgName, entry);
                if (plugin) results.push(plugin);
            }
        } else {
            const plugin = await checkPackage(fs, nodeModulesPath, e.name, entry);
            if (plugin) results.push(plugin);
        }
    }

    return results;
}

async function checkPackage(
    fs: NativeFS,
    nodeModulesPath: string,
    pkgName: string,
    entry: 'main' | 'editor',
): Promise<DiscoveredPlugin | null> {
    if (SKIP_PACKAGES.has(pkgName)) return null;

    const pkgJsonPath = joinPath(nodeModulesPath, pkgName, 'package.json');
    const content = await fs.readFile(pkgJsonPath);
    if (!content) return null;

    try {
        const pkg = JSON.parse(content);
        if (pkg.esengine?.type !== 'plugin') return null;

        const entryFile = entry === 'editor' ? pkg.esengine?.editor : pkg.main;
        if (!entryFile) return null;

        return {
            packageName: pkgName,
            entryPath: joinPath(nodeModulesPath, pkgName, entryFile),
            displayName: pkg.esengine?.displayName ?? pkg.name,
            version: pkg.version,
            description: pkg.esengine?.description ?? pkg.description,
        };
    } catch {
        return null;
    }
}
