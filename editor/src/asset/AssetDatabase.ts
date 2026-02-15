/**
 * @file    AssetDatabase.ts
 * @brief   Unified asset metadata center with UUID mapping, labels, addresses, and groups
 */

import type { SceneData } from '../types/SceneTypes';
import type { TextureMetadata } from '../types/TextureMetadata';
import { joinPath, getFileExtension } from '../utils/path';
import type { NativeFS, FileStats } from '../types/NativeFS';
import { ASSET_EXTENSIONS, getAssetType } from './AssetTypes';
import {
    type AssetMeta,
    type TextureImporterSettings,
    createDefaultMeta,
    upgradeMeta,
    serializeMeta,
    getDefaultImporterForType,
} from './ImporterTypes';
import { AssetGroupService } from './AssetGroup';

// =============================================================================
// Types
// =============================================================================

export interface AssetEntry {
    uuid: string;
    path: string;
    type: string;
    labels: Set<string>;
    address: string | null;
    group: string;
    importer: Record<string, unknown>;
    platformOverrides: Record<string, Record<string, unknown>>;
    fileSize: number;
    lastModified: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
    return UUID_REGEX.test(value);
}

// =============================================================================
// AssetDatabase
// =============================================================================

export class AssetDatabase {
    private uuidToEntry_ = new Map<string, AssetEntry>();
    private pathToUuid_ = new Map<string, string>();
    private addressToUuid_ = new Map<string, string>();
    private labelIndex_ = new Map<string, Set<string>>();
    private groupIndex_ = new Map<string, Set<string>>();
    private fs_: NativeFS | null = null;
    private projectDir_ = '';
    private groupService_: AssetGroupService | null = null;

    async initialize(projectDir: string, fs: NativeFS): Promise<void> {
        console.log(`[AssetDatabase] initialize: projectDir="${projectDir}"`);
        this.fs_ = fs;
        this.projectDir_ = projectDir;
        this.uuidToEntry_.clear();
        this.pathToUuid_.clear();
        this.addressToUuid_.clear();
        this.labelIndex_.clear();
        this.groupIndex_.clear();

        this.groupService_ = new AssetGroupService(projectDir, fs);
        await this.groupService_.load();

        const assetsDir = joinPath(projectDir, 'assets');
        const assetsDirExists = await fs.exists(assetsDir);
        console.log(`[AssetDatabase] assetsDir="${assetsDir}", exists=${assetsDirExists}`);
        if (assetsDirExists) {
            await this.scanDirectory(assetsDir, 'assets');
        }
        console.log(`[AssetDatabase] initialized: ${this.uuidToEntry_.size} entries registered`);
    }

    // =========================================================================
    // UUID ↔ Path (backward-compatible API)
    // =========================================================================

    getPath(uuid: string): string | undefined {
        const path = this.uuidToEntry_.get(uuid)?.path;
        if (!path) {
            console.warn(`[AssetDatabase] getPath: UUID "${uuid}" not found (${this.uuidToEntry_.size} entries registered)`);
        }
        return path;
    }

    getUuid(path: string): string | undefined {
        return this.pathToUuid_.get(path);
    }

    // =========================================================================
    // Entry Access
    // =========================================================================

    getEntry(uuid: string): AssetEntry | undefined {
        return this.uuidToEntry_.get(uuid);
    }

    getEntryByPath(path: string): AssetEntry | undefined {
        const uuid = this.pathToUuid_.get(path);
        return uuid ? this.uuidToEntry_.get(uuid) : undefined;
    }

    getAllEntries(): IterableIterator<AssetEntry> {
        return this.uuidToEntry_.values();
    }

    get entryCount(): number {
        return this.uuidToEntry_.size;
    }

    // =========================================================================
    // Address Lookup
    // =========================================================================

    getUuidByAddress(address: string): string | undefined {
        return this.addressToUuid_.get(address);
    }

    getEntryByAddress(address: string): AssetEntry | undefined {
        const uuid = this.addressToUuid_.get(address);
        return uuid ? this.uuidToEntry_.get(uuid) : undefined;
    }

    // =========================================================================
    // Label Queries
    // =========================================================================

    getUuidsByLabel(label: string): Set<string> {
        return this.labelIndex_.get(label) ?? new Set();
    }

    getAllLabels(): string[] {
        return [...this.labelIndex_.keys()];
    }

    // =========================================================================
    // Group Queries
    // =========================================================================

    getUuidsByGroup(group: string): Set<string> {
        return this.groupIndex_.get(group) ?? new Set();
    }

    getAllGroups(): string[] {
        return [...this.groupIndex_.keys()];
    }

    getGroupService(): AssetGroupService | null {
        return this.groupService_;
    }

    // =========================================================================
    // Meta File Operations
    // =========================================================================

    async ensureMeta(relativePath: string): Promise<string> {
        const existing = this.pathToUuid_.get(relativePath);
        if (existing) return existing;

        if (!this.fs_) {
            throw new Error('AssetDatabase not initialized');
        }

        const fullPath = joinPath(this.projectDir_, relativePath);
        const metaPath = `${fullPath}.meta`;

        if (await this.fs_.exists(metaPath)) {
            const content = await this.fs_.readFile(metaPath);
            if (content) {
                try {
                    const raw = JSON.parse(content) as Record<string, unknown>;
                    if (raw.uuid) {
                        const meta = upgradeMeta(raw);
                        if (raw.version !== '2.0') {
                            await this.fs_.writeFile(metaPath, serializeMeta(meta));
                        }
                        this.registerEntry(meta, relativePath);
                        return meta.uuid;
                    }
                } catch {
                    // Fall through to create new meta
                }
            }
        }

        const uuid = crypto.randomUUID();
        const assetType = getAssetType(relativePath);
        const meta = createDefaultMeta(uuid, assetType);

        await this.fs_.writeFile(metaPath, serializeMeta(meta));
        this.registerEntry(meta, relativePath);
        return uuid;
    }

    async updateMeta(uuid: string, updates: Partial<Pick<AssetEntry, 'labels' | 'address' | 'group' | 'importer' | 'platformOverrides'>>): Promise<void> {
        const entry = this.uuidToEntry_.get(uuid);
        if (!entry || !this.fs_) return;

        if (updates.address !== undefined) {
            if (entry.address) {
                this.addressToUuid_.delete(entry.address);
            }
            entry.address = updates.address;
            if (updates.address) {
                this.addressToUuid_.set(updates.address, uuid);
            }
        }

        if (updates.labels !== undefined) {
            for (const oldLabel of entry.labels) {
                this.labelIndex_.get(oldLabel)?.delete(uuid);
            }
            entry.labels = updates.labels;
            for (const newLabel of entry.labels) {
                if (!this.labelIndex_.has(newLabel)) {
                    this.labelIndex_.set(newLabel, new Set());
                }
                this.labelIndex_.get(newLabel)!.add(uuid);
            }
        }

        if (updates.group !== undefined) {
            const oldGroup = entry.group;
            this.groupIndex_.get(oldGroup)?.delete(uuid);
            entry.group = updates.group;
            if (!this.groupIndex_.has(updates.group)) {
                this.groupIndex_.set(updates.group, new Set());
            }
            this.groupIndex_.get(updates.group)!.add(uuid);
        }

        if (updates.importer !== undefined) {
            entry.importer = updates.importer;
        }

        if (updates.platformOverrides !== undefined) {
            entry.platformOverrides = updates.platformOverrides;
        }

        await this.writeMetaFile(entry);
    }

    // =========================================================================
    // Scene Migration (backward-compatible)
    // =========================================================================

    async migrateScene(scene: SceneData): Promise<boolean> {
        if (scene.version === '2.0') return false;
        if (!this.fs_) return false;

        let changed = false;

        for (const entity of scene.entities) {
            for (const comp of entity.components || []) {
                changed = await this.migrateComponentRefs(comp) || changed;
            }
            if (entity.prefab?.prefabPath && !isUUID(entity.prefab.prefabPath)) {
                entity.prefab.prefabPath = await this.ensureMeta(entity.prefab.prefabPath);
                changed = true;
            }
        }

        if (scene.textureMetadata) {
            const newMetadata: Record<string, TextureMetadata> = {};
            for (const [key, value] of Object.entries(scene.textureMetadata)) {
                if (isUUID(key)) {
                    newMetadata[key] = value;
                } else {
                    const uuid = await this.ensureMeta(key);
                    newMetadata[uuid] = value;
                    changed = true;
                }
            }
            scene.textureMetadata = newMetadata;
        }

        if (changed) {
            scene.version = '2.0';
        }

        return changed;
    }

    resolveSceneAssetPaths(scene: SceneData): void {
        for (const entity of scene.entities) {
            for (const comp of entity.components || []) {
                this.resolveComponentRefs(comp);
            }
            if (entity.prefab?.prefabPath && isUUID(entity.prefab.prefabPath)) {
                const path = this.getPath(entity.prefab.prefabPath);
                if (path) {
                    entity.prefab.prefabPath = path;
                }
            }
        }

        if (scene.textureMetadata) {
            const resolved: Record<string, TextureMetadata> = {};
            for (const [key, value] of Object.entries(scene.textureMetadata)) {
                if (isUUID(key)) {
                    const path = this.getPath(key);
                    resolved[path ?? key] = value;
                } else {
                    resolved[key] = value;
                }
            }
            scene.textureMetadata = resolved;
        }
    }

    // =========================================================================
    // Registration / Unregistration
    // =========================================================================

    unregister(relativePath: string): void {
        const uuid = this.pathToUuid_.get(relativePath);
        if (!uuid) return;

        const entry = this.uuidToEntry_.get(uuid);
        if (entry) {
            if (entry.address) {
                this.addressToUuid_.delete(entry.address);
            }
            for (const label of entry.labels) {
                this.labelIndex_.get(label)?.delete(uuid);
            }
            this.groupIndex_.get(entry.group)?.delete(uuid);
        }

        this.uuidToEntry_.delete(uuid);
        this.pathToUuid_.delete(relativePath);
    }

    updatePath(oldRelativePath: string, newRelativePath: string): void {
        const uuid = this.pathToUuid_.get(oldRelativePath);
        if (!uuid) return;

        const entry = this.uuidToEntry_.get(uuid);
        if (entry) {
            entry.path = newRelativePath;
        }
        this.pathToUuid_.delete(oldRelativePath);
        this.pathToUuid_.set(newRelativePath, uuid);
    }

    // =========================================================================
    // Importer Convenience
    // =========================================================================

    getSliceBorder(uuid: string): { left: number; right: number; top: number; bottom: number } | null {
        const entry = this.uuidToEntry_.get(uuid);
        if (!entry || entry.type !== 'texture') return null;
        const importer = entry.importer as unknown as TextureImporterSettings;
        return importer.sliceBorder ?? null;
    }

    // =========================================================================
    // Private
    // =========================================================================

    private registerEntry(meta: AssetMeta, relativePath: string, stats?: FileStats | null): void {
        const group = this.groupService_
            ? this.groupService_.resolveGroup(relativePath, undefined)
            : 'default';

        const entry: AssetEntry = {
            uuid: meta.uuid,
            path: relativePath,
            type: meta.type,
            labels: new Set(meta.labels),
            address: meta.address,
            group,
            importer: meta.importer,
            platformOverrides: meta.platformOverrides,
            fileSize: stats?.size ?? 0,
            lastModified: stats?.modified?.getTime() ?? 0,
        };

        this.uuidToEntry_.set(meta.uuid, entry);
        this.pathToUuid_.set(relativePath, meta.uuid);

        if (meta.address) {
            this.addressToUuid_.set(meta.address, meta.uuid);
        }

        for (const label of meta.labels) {
            if (!this.labelIndex_.has(label)) {
                this.labelIndex_.set(label, new Set());
            }
            this.labelIndex_.get(label)!.add(meta.uuid);
        }

        if (!this.groupIndex_.has(group)) {
            this.groupIndex_.set(group, new Set());
        }
        this.groupIndex_.get(group)!.add(meta.uuid);
    }

    private async writeMetaFile(entry: AssetEntry): Promise<void> {
        if (!this.fs_) return;
        const meta: AssetMeta = {
            uuid: entry.uuid,
            version: '2.0',
            type: entry.type,
            labels: [...entry.labels],
            address: entry.address,
            importer: entry.importer,
            platformOverrides: entry.platformOverrides,
        };
        const fullPath = joinPath(this.projectDir_, entry.path);
        await this.fs_.writeFile(`${fullPath}.meta`, serializeMeta(meta));
    }

    private async scanDirectory(absolutePath: string, relativePath: string): Promise<void> {
        if (!this.fs_) return;

        const entries = await this.fs_.listDirectoryDetailed(absolutePath);

        for (const entry of entries) {
            const childAbsolute = joinPath(absolutePath, entry.name);
            const childRelative = `${relativePath}/${entry.name}`;

            if (entry.isDirectory) {
                await this.scanDirectory(childAbsolute, childRelative);
            } else if (entry.name.endsWith('.meta')) {
                const content = await this.fs_.readFile(childAbsolute);
                if (content) {
                    try {
                        const raw = JSON.parse(content) as Record<string, unknown>;
                        if (raw.uuid) {
                            const meta = upgradeMeta(raw);
                            const assetRelPath = childRelative.replace(/\.meta$/, '');

                            if (raw.version !== '2.0') {
                                await this.fs_.writeFile(childAbsolute, serializeMeta(meta));
                            }

                            const assetAbsolute = childAbsolute.replace(/\.meta$/, '');
                            const stats = await this.fs_.getFileStats(assetAbsolute);
                            this.registerEntry(meta, assetRelPath, stats);
                        }
                    } catch {
                        // Skip invalid meta files
                    }
                }
            } else {
                const ext = getFileExtension(entry.name);
                if (ASSET_EXTENSIONS.has(ext)) {
                    const metaAbsolute = `${childAbsolute}.meta`;
                    if (!await this.fs_.exists(metaAbsolute)) {
                        await this.ensureMeta(childRelative);
                    }
                }
            }
        }
    }

    // =========================================================================
    // Component Ref Helpers (used by migrateScene / resolveSceneAssetPaths)
    // =========================================================================

    private async migrateComponentRefs(comp: { type: string; data: Record<string, unknown> }): Promise<boolean> {
        let changed = false;
        const refs = getComponentRefFields(comp.type);
        if (!refs || !comp.data) return false;

        for (const field of refs) {
            const value = comp.data[field];
            if (typeof value === 'string' && !isUUID(value)) {
                const uuid = await this.ensureMeta(value);
                comp.data[field] = uuid;
                changed = true;
            }
        }
        return changed;
    }

    private resolveComponentRefs(comp: { type: string; data: Record<string, unknown> }): void {
        const refs = getComponentRefFields(comp.type);
        if (!refs || !comp.data) return;

        for (const field of refs) {
            const value = comp.data[field];
            if (typeof value === 'string' && isUUID(value)) {
                const path = this.getPath(value);
                if (path) {
                    comp.data[field] = path;
                }
            }
        }
    }
}

// =============================================================================
// Component → Asset Reference Field Registry
// =============================================================================

import { getComponentAssetFields } from 'esengine';

export function getComponentRefFields(componentType: string): string[] | undefined {
    const fields = getComponentAssetFields(componentType);
    return fields.length > 0 ? fields : undefined;
}

// =============================================================================
// Singleton
// =============================================================================

let instance: AssetDatabase | null = null;

export function getAssetDatabase(): AssetDatabase {
    if (!instance) {
        instance = new AssetDatabase();
    }
    return instance;
}

export function resetAssetDatabase(): void {
    instance = null;
}

// Backward-compatible aliases
export { AssetDatabase as AssetLibrary };
export const getAssetLibrary = getAssetDatabase;
export const resetAssetLibrary = resetAssetDatabase;
