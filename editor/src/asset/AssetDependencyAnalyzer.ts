/**
 * @file    AssetDependencyAnalyzer.ts
 * @brief   Static analysis of asset dependencies across scenes, materials, atlases, and fonts
 */

import type { AssetDatabase } from './AssetDatabase';
import { isUUID, getComponentRefFields } from './AssetDatabase';
import { looksLikeAssetPath } from './AssetTypes';
import { joinPath, isAbsolutePath, getDirName } from '../utils/path';
import type { NativeFS } from '../types/NativeFS';

// =============================================================================
// Types
// =============================================================================

export interface AssetRefScanner {
    componentType: string;
    extractRefs(data: Record<string, unknown>): string[];
}

export interface DependencyGraph {
    dependencies: Map<string, Set<string>>;
    dependents: Map<string, Set<string>>;
    unreferenced: Set<string>;
    broken: Map<string, string[]>;
}

// =============================================================================
// Scanners
// =============================================================================

const customScanners: AssetRefScanner[] = [];

export function registerRefScanner(scanner: AssetRefScanner): void {
    customScanners.push(scanner);
}

function getScanner(componentType: string): AssetRefScanner | undefined {
    const custom = customScanners.find(s => s.componentType === componentType);
    if (custom) return custom;
    const fields = getComponentRefFields(componentType);
    if (!fields) return undefined;
    return {
        componentType,
        extractRefs: (d) => fields.map(f => d[f] as string).filter(Boolean),
    };
}

// =============================================================================
// AssetDependencyAnalyzer
// =============================================================================

export class AssetDependencyAnalyzer {
    private fs_: NativeFS;
    private projectDir_: string;
    private assetDb_: AssetDatabase;

    constructor(fs: NativeFS, projectDir: string, assetDb: AssetDatabase) {
        this.fs_ = fs;
        this.projectDir_ = projectDir;
        this.assetDb_ = assetDb;
    }

    async analyze(scenePaths: string[]): Promise<DependencyGraph> {
        const dependencies = new Map<string, Set<string>>();
        const dependents = new Map<string, Set<string>>();

        for (const scenePath of scenePaths) {
            const sceneUuid = this.assetDb_.getUuid(scenePath);
            const sceneKey = sceneUuid ?? scenePath;

            const fullPath = isAbsolutePath(scenePath)
                ? scenePath
                : joinPath(this.projectDir_, scenePath);

            const content = await this.fs_.readFile(fullPath);
            if (!content) continue;

            try {
                const scene = JSON.parse(content);
                const refs = this.extractSceneRefs(scene);
                const visited = new Set<string>();

                for (const ref of refs) {
                    const resolvedRef = this.resolveRef(ref);
                    const refUuid = this.assetDb_.getUuid(resolvedRef) ?? resolvedRef;

                    this.addEdge(dependencies, dependents, sceneKey, refUuid);

                    await this.collectTransitiveRefs(resolvedRef, refUuid, dependencies, dependents, visited);
                }
            } catch {
                continue;
            }
        }

        const allUuids = new Set<string>();
        for (const entry of this.assetDb_.getAllEntries()) {
            allUuids.add(entry.uuid);
        }

        const referenced = new Set<string>();
        for (const [, deps] of dependencies) {
            for (const dep of deps) {
                referenced.add(dep);
            }
        }
        for (const key of dependencies.keys()) {
            referenced.add(key);
        }

        const unreferenced = new Set<string>();
        for (const uuid of allUuids) {
            const entry = this.assetDb_.getEntry(uuid);
            if (!entry) continue;
            if (entry.type === 'json' && entry.path.endsWith('.esscene')) continue;
            if (!referenced.has(uuid) && !dependents.has(uuid)) {
                unreferenced.add(uuid);
            }
        }

        const broken = new Map<string, string[]>();
        for (const [source, deps] of dependencies) {
            const missing: string[] = [];
            for (const dep of deps) {
                if (isUUID(dep) && !this.assetDb_.getEntry(dep)) {
                    missing.push(dep);
                }
            }
            if (missing.length > 0) {
                broken.set(source, missing);
            }
        }

        return { dependencies, dependents, unreferenced, broken };
    }

    // =========================================================================
    // Scene Ref Extraction (using registered scanners)
    // =========================================================================

    private extractSceneRefs(scene: Record<string, unknown>): string[] {
        const refs: string[] = [];
        const entities = scene.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
            prefab?: { prefabPath: string };
        }> | undefined;

        if (!entities) return refs;

        for (const entity of entities) {
            if (entity.prefab?.prefabPath) {
                refs.push(entity.prefab.prefabPath);
            }
            for (const comp of entity.components || []) {
                const scanner = getScanner(comp.type);
                if (scanner && comp.data) {
                    refs.push(...scanner.extractRefs(comp.data));
                }
            }
        }

        const textureMetadata = scene.textureMetadata as Record<string, unknown> | undefined;
        if (textureMetadata) {
            refs.push(...Object.keys(textureMetadata));
        }

        return refs;
    }

    // =========================================================================
    // Transitive Reference Collection
    // =========================================================================

    private async collectTransitiveRefs(
        resolvedPath: string,
        uuid: string,
        dependencies: Map<string, Set<string>>,
        dependents: Map<string, Set<string>>,
        visited: Set<string>
    ): Promise<void> {
        if (visited.has(resolvedPath)) return;
        visited.add(resolvedPath);

        if (resolvedPath.endsWith('.esmaterial')) {
            await this.collectMaterialRefs(resolvedPath, uuid, dependencies, dependents, visited);
        } else if (resolvedPath.endsWith('.atlas')) {
            await this.collectAtlasRefs(resolvedPath, uuid, dependencies, dependents);
        } else if (resolvedPath.endsWith('.bmfont') || resolvedPath.endsWith('.fnt')) {
            await this.collectFontRefs(resolvedPath, uuid, dependencies, dependents);
        } else if (resolvedPath.endsWith('.esprefab')) {
            await this.collectPrefabRefs(resolvedPath, uuid, dependencies, dependents, visited);
        }
    }

    private async collectMaterialRefs(
        materialPath: string,
        materialUuid: string,
        dependencies: Map<string, Set<string>>,
        dependents: Map<string, Set<string>>,
        _visited: Set<string>
    ): Promise<void> {
        const fullPath = isAbsolutePath(materialPath)
            ? materialPath
            : joinPath(this.projectDir_, materialPath);

        const content = await this.fs_.readFile(fullPath);
        if (!content) return;

        try {
            const material = JSON.parse(content);

            if (typeof material.shader === 'string' && material.shader) {
                const shaderPath = material.shader;
                const shaderUuid = this.assetDb_.getUuid(shaderPath) ?? shaderPath;
                this.addEdge(dependencies, dependents, materialUuid, shaderUuid);
            }

            if (material.properties && typeof material.properties === 'object') {
                for (const value of Object.values(material.properties)) {
                    if (looksLikeAssetPath(value)) {
                        const texUuid = this.assetDb_.getUuid(value) ?? value;
                        this.addEdge(dependencies, dependents, materialUuid, texUuid);
                    }
                }
            }
        } catch {
            // Ignore parse errors
        }
    }

    private async collectAtlasRefs(
        atlasPath: string,
        atlasUuid: string,
        dependencies: Map<string, Set<string>>,
        dependents: Map<string, Set<string>>
    ): Promise<void> {
        const fullPath = isAbsolutePath(atlasPath)
            ? atlasPath
            : joinPath(this.projectDir_, atlasPath);

        const content = await this.fs_.readFile(fullPath);
        if (!content) return;

        const atlasDir = getDirName(atlasPath);
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (line && line.indexOf(':') === -1 && (/\.png$/i.test(line) || /\.jpg$/i.test(line))) {
                const texturePath = atlasDir ? `${atlasDir}/${line}` : line;
                const texUuid = this.assetDb_.getUuid(texturePath) ?? texturePath;
                this.addEdge(dependencies, dependents, atlasUuid, texUuid);
            }
        }
    }

    private async collectFontRefs(
        fontPath: string,
        fontUuid: string,
        dependencies: Map<string, Set<string>>,
        dependents: Map<string, Set<string>>
    ): Promise<void> {
        const fullPath = isAbsolutePath(fontPath)
            ? fontPath
            : joinPath(this.projectDir_, fontPath);

        const content = await this.fs_.readFile(fullPath);
        if (!content) return;

        if (fontPath.endsWith('.bmfont')) {
            try {
                const json = JSON.parse(content);
                if (json.fntFile) {
                    const dir = getDirName(fontPath);
                    const fntPath = dir ? `${dir}/${json.fntFile}` : json.fntFile;
                    const fntUuid = this.assetDb_.getUuid(fntPath) ?? fntPath;
                    this.addEdge(dependencies, dependents, fontUuid, fntUuid);
                }
            } catch {
                // ignore
            }
        } else {
            const pageMatch = content.match(/file="([^"]+)"/);
            if (pageMatch) {
                const dir = getDirName(fontPath);
                const texPath = dir ? `${dir}/${pageMatch[1]}` : pageMatch[1];
                const texUuid = this.assetDb_.getUuid(texPath) ?? texPath;
                this.addEdge(dependencies, dependents, fontUuid, texUuid);
            }
        }
    }

    private async collectPrefabRefs(
        prefabPath: string,
        prefabUuid: string,
        dependencies: Map<string, Set<string>>,
        dependents: Map<string, Set<string>>,
        visited: Set<string>
    ): Promise<void> {
        const fullPath = isAbsolutePath(prefabPath)
            ? prefabPath
            : joinPath(this.projectDir_, prefabPath);

        const content = await this.fs_.readFile(fullPath);
        if (!content) return;

        try {
            const prefab = JSON.parse(content);
            const entities = prefab.entities as Array<{
                components: Array<{ type: string; data: Record<string, unknown> }>;
                nestedPrefab?: { prefabPath: string };
            }> | undefined;

            if (!entities) return;

            for (const entity of entities) {
                if (entity.nestedPrefab?.prefabPath) {
                    const nestedRef = this.resolveRef(entity.nestedPrefab.prefabPath);
                    const nestedUuid = this.assetDb_.getUuid(nestedRef) ?? nestedRef;
                    this.addEdge(dependencies, dependents, prefabUuid, nestedUuid);
                    await this.collectTransitiveRefs(nestedRef, nestedUuid, dependencies, dependents, visited);
                }

                for (const comp of entity.components || []) {
                    const scanner = getScanner(comp.type);
                    if (scanner && comp.data) {
                        const refs = scanner.extractRefs(comp.data);
                        for (const ref of refs) {
                            const resolvedRef = this.resolveRef(ref);
                            const refUuid = this.assetDb_.getUuid(resolvedRef) ?? resolvedRef;
                            this.addEdge(dependencies, dependents, prefabUuid, refUuid);
                            await this.collectTransitiveRefs(resolvedRef, refUuid, dependencies, dependents, visited);
                        }
                    }
                }
            }
        } catch {
            // ignore
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private resolveRef(ref: string): string {
        if (isUUID(ref)) {
            return this.assetDb_.getPath(ref) ?? ref;
        }
        return ref;
    }

    private addEdge(
        dependencies: Map<string, Set<string>>,
        dependents: Map<string, Set<string>>,
        from: string,
        to: string
    ): void {
        if (!dependencies.has(from)) {
            dependencies.set(from, new Set());
        }
        dependencies.get(from)!.add(to);

        if (!dependents.has(to)) {
            dependents.set(to, new Set());
        }
        dependents.get(to)!.add(from);
    }
}

// =============================================================================
// Convenience: collect referenced assets from scenes (replaces AssetReferenceCollector)
// =============================================================================

export async function collectReferencedAssets(
    fs: NativeFS,
    projectDir: string,
    assetDb: AssetDatabase,
    scenePaths: string[]
): Promise<Set<string>> {
    const analyzer = new AssetDependencyAnalyzer(fs, projectDir, assetDb);
    const graph = await analyzer.analyze(scenePaths);

    const result = new Set<string>();

    for (const [, deps] of graph.dependencies) {
        for (const uuid of deps) {
            const path = assetDb.getPath(uuid);
            if (path) {
                result.add(path);
            } else if (!isUUID(uuid)) {
                result.add(uuid);
            }
        }
    }

    return result;
}
