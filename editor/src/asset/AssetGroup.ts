/**
 * @file    AssetGroup.ts
 * @brief   Asset group and label management service
 */

import type { NativeFS } from '../types/NativeFS';
import { joinPath } from '../utils/path';

// =============================================================================
// Types
// =============================================================================

export type BundleMode = 'together' | 'separate' | 'perFile';

export interface AssetGroupDef {
    name: string;
    description: string;
    bundleMode: BundleMode;
    labels: string[];
    include: string[];
}

export interface AssetGroupsConfig {
    version: '1.0';
    groups: AssetGroupDef[];
    allLabels: string[];
}

// =============================================================================
// Defaults
// =============================================================================

const CONFIG_PATH = '.esengine/asset-groups.json';

function createDefaultConfig(): AssetGroupsConfig {
    return {
        version: '1.0',
        groups: [
            {
                name: 'default',
                description: 'Default group for all assets',
                bundleMode: 'together',
                labels: [],
                include: ['assets/**/*'],
            },
        ],
        allLabels: [],
    };
}

// =============================================================================
// AssetGroupService
// =============================================================================

export class AssetGroupService {
    private config_: AssetGroupsConfig;
    private fs_: NativeFS;
    private projectDir_: string;

    constructor(projectDir: string, fs: NativeFS) {
        this.projectDir_ = projectDir;
        this.fs_ = fs;
        this.config_ = createDefaultConfig();
    }

    get config(): Readonly<AssetGroupsConfig> {
        return this.config_;
    }

    get groups(): readonly AssetGroupDef[] {
        return this.config_.groups;
    }

    get allLabels(): readonly string[] {
        return this.config_.allLabels;
    }

    async load(): Promise<void> {
        const fullPath = joinPath(this.projectDir_, CONFIG_PATH);
        const content = await this.fs_.readFile(fullPath);
        if (!content) {
            this.config_ = createDefaultConfig();
            return;
        }

        try {
            const data = JSON.parse(content);
            this.config_ = {
                version: '1.0',
                groups: Array.isArray(data.groups) ? data.groups : createDefaultConfig().groups,
                allLabels: Array.isArray(data.allLabels) ? data.allLabels : [],
            };
        } catch {
            this.config_ = createDefaultConfig();
        }
    }

    async save(): Promise<void> {
        const dirPath = joinPath(this.projectDir_, '.esengine');
        await this.fs_.createDirectory(dirPath);
        const fullPath = joinPath(this.projectDir_, CONFIG_PATH);
        await this.fs_.writeFile(fullPath, JSON.stringify(this.config_, null, 4));
    }

    // =========================================================================
    // Group CRUD
    // =========================================================================

    getGroup(name: string): AssetGroupDef | undefined {
        return this.config_.groups.find(g => g.name === name);
    }

    addGroup(group: AssetGroupDef): void {
        if (this.config_.groups.some(g => g.name === group.name)) return;
        this.config_.groups.push(group);
    }

    removeGroup(name: string): void {
        if (name === 'default') return;
        this.config_.groups = this.config_.groups.filter(g => g.name !== name);
    }

    renameGroup(oldName: string, newName: string): void {
        if (oldName === 'default') return;
        const group = this.config_.groups.find(g => g.name === oldName);
        if (group) {
            group.name = newName;
        }
    }

    updateGroup(name: string, updates: Partial<Omit<AssetGroupDef, 'name'>>): void {
        const group = this.config_.groups.find(g => g.name === name);
        if (!group) return;
        if (updates.description !== undefined) group.description = updates.description;
        if (updates.bundleMode !== undefined) group.bundleMode = updates.bundleMode;
        if (updates.labels !== undefined) group.labels = updates.labels;
        if (updates.include !== undefined) group.include = updates.include;
    }

    // =========================================================================
    // Label CRUD
    // =========================================================================

    addLabel(label: string): void {
        if (!this.config_.allLabels.includes(label)) {
            this.config_.allLabels.push(label);
        }
    }

    removeLabel(label: string): void {
        this.config_.allLabels = this.config_.allLabels.filter(l => l !== label);
        for (const group of this.config_.groups) {
            group.labels = group.labels.filter(l => l !== label);
        }
    }

    // =========================================================================
    // Asset → Group Resolution
    // =========================================================================

    resolveGroup(assetPath: string, metaGroup: string | undefined): string {
        if (metaGroup && metaGroup !== 'default') {
            if (this.config_.groups.some(g => g.name === metaGroup)) {
                return metaGroup;
            }
        }

        for (const group of this.config_.groups) {
            if (group.name === 'default') continue;
            if (this.matchesIncludes(assetPath, group.include)) {
                return group.name;
            }
        }

        return 'default';
    }

    private matchesIncludes(assetPath: string, patterns: string[]): boolean {
        for (const pattern of patterns) {
            if (this.globMatch(assetPath, pattern)) {
                return true;
            }
        }
        return false;
    }

    private globMatch(path: string, pattern: string): boolean {
        const regexStr = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '§')
            .replace(/\*/g, '[^/]*')
            .replace(/§/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${regexStr}$`).test(path);
    }
}
