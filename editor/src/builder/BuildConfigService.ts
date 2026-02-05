/**
 * @file    BuildConfigService.ts
 * @brief   Project-level build configuration management
 */

import {
    BuildConfig,
    BuildSettings,
    BuildPlatform,
    createDefaultBuildSettings,
    createDefaultBuildConfig,
} from '../types/BuildTypes';

// =============================================================================
// Types
// =============================================================================

export interface BuildSettingsFile {
    version: '1.0';
    activePlatform: BuildPlatform;
    activeConfigId: string;
    configs: BuildConfig[];
}

export type ConfigChangeListener = (settings: BuildSettings) => void;

// =============================================================================
// Constants
// =============================================================================

const CONFIG_VERSION = '1.0';
const CONFIG_DIR = '.esengine';
const CONFIG_FILENAME = 'build.json';
const LEGACY_STORAGE_KEY = 'esengine_build_settings';

// =============================================================================
// BuildConfigService Class
// =============================================================================

export class BuildConfigService {
    private projectDir_: string;
    private settings_: BuildSettings;
    private fs_: NativeFileSystem | null;
    private listeners_: Set<ConfigChangeListener>;
    private loaded_: boolean;

    constructor(projectDir: string) {
        this.projectDir_ = projectDir;
        this.settings_ = createDefaultBuildSettings();
        this.fs_ = window.__esengine_fs ?? null;
        this.listeners_ = new Set();
        this.loaded_ = false;
    }

    private getConfigPath(): string {
        return `${this.projectDir_}/${CONFIG_DIR}/${CONFIG_FILENAME}`;
    }

    private getConfigDir(): string {
        return `${this.projectDir_}/${CONFIG_DIR}`;
    }

    private notify(): void {
        for (const listener of this.listeners_) {
            listener(this.settings_);
        }
    }

    onChange(listener: ConfigChangeListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    async load(): Promise<BuildSettings> {
        if (!this.fs_) {
            const migrated = await this.migrateFromLocalStorage();
            if (!migrated) {
                this.settings_ = createDefaultBuildSettings();
            }
            this.loaded_ = true;
            return this.settings_;
        }

        const configPath = this.getConfigPath();

        try {
            const content = await this.fs_.readFile(configPath);
            const decoder = new TextDecoder();
            const jsonStr = decoder.decode(content);
            const file = JSON.parse(jsonStr) as BuildSettingsFile;

            if (file.version === CONFIG_VERSION) {
                this.settings_ = {
                    activePlatform: file.activePlatform,
                    activeConfigId: file.activeConfigId,
                    configs: file.configs,
                };
                this.loaded_ = true;
                return this.settings_;
            }
        } catch {
            // Config file doesn't exist, try migration
        }

        const migrated = await this.migrateFromLocalStorage();
        if (migrated) {
            this.loaded_ = true;
            return this.settings_;
        }

        this.settings_ = createDefaultBuildSettings();
        this.loaded_ = true;
        return this.settings_;
    }

    async save(): Promise<void> {
        if (!this.fs_) return;

        const configDir = this.getConfigDir();
        const configPath = this.getConfigPath();

        try {
            await this.fs_.mkdir(configDir, { recursive: true });
        } catch {
            // Directory may already exist
        }

        const file: BuildSettingsFile = {
            version: CONFIG_VERSION,
            activePlatform: this.settings_.activePlatform,
            activeConfigId: this.settings_.activeConfigId,
            configs: this.settings_.configs,
        };

        const jsonStr = JSON.stringify(file, null, 2);
        const encoder = new TextEncoder();
        await this.fs_.writeFile(configPath, encoder.encode(jsonStr));
    }

    async migrateFromLocalStorage(): Promise<boolean> {
        try {
            const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (!stored) return false;

            const settings = JSON.parse(stored) as BuildSettings;
            if (!settings.configs || settings.configs.length === 0) {
                return false;
            }

            this.settings_ = settings;
            await this.save();

            localStorage.removeItem(LEGACY_STORAGE_KEY);
            console.log('[BuildConfigService] Migrated settings from localStorage to project file');
            return true;
        } catch {
            return false;
        }
    }

    getSettings(): BuildSettings {
        return this.settings_;
    }

    getConfigs(): BuildConfig[] {
        return this.settings_.configs;
    }

    getConfig(id: string): BuildConfig | undefined {
        return this.settings_.configs.find(c => c.id === id);
    }

    getActiveConfig(): BuildConfig | undefined {
        return this.getConfig(this.settings_.activeConfigId);
    }

    getConfigsByPlatform(platform: BuildPlatform): BuildConfig[] {
        return this.settings_.configs.filter(c => c.platform === platform);
    }

    addConfig(config: BuildConfig): void {
        this.settings_.configs.push(config);
        this.notify();
    }

    updateConfig(id: string, updates: Partial<BuildConfig>): void {
        const index = this.settings_.configs.findIndex(c => c.id === id);
        if (index !== -1) {
            this.settings_.configs[index] = {
                ...this.settings_.configs[index],
                ...updates,
            };
            this.notify();
        }
    }

    removeConfig(id: string): void {
        const index = this.settings_.configs.findIndex(c => c.id === id);
        if (index !== -1) {
            this.settings_.configs.splice(index, 1);

            if (this.settings_.activeConfigId === id) {
                const platformConfigs = this.getConfigsByPlatform(this.settings_.activePlatform);
                this.settings_.activeConfigId = platformConfigs[0]?.id || '';
            }

            this.notify();
        }
    }

    duplicateConfig(id: string, newName: string): BuildConfig | undefined {
        const original = this.getConfig(id);
        if (!original) return undefined;

        const newConfig: BuildConfig = {
            ...JSON.parse(JSON.stringify(original)),
            id: `${original.platform}-${Date.now()}`,
            name: newName,
        };

        this.addConfig(newConfig);
        return newConfig;
    }

    setActivePlatform(platform: BuildPlatform): void {
        this.settings_.activePlatform = platform;

        const platformConfigs = this.getConfigsByPlatform(platform);
        const currentActive = this.getActiveConfig();
        if (!currentActive || currentActive.platform !== platform) {
            this.settings_.activeConfigId = platformConfigs[0]?.id || '';
        }

        this.notify();
    }

    setActiveConfig(id: string): void {
        const config = this.getConfig(id);
        if (config) {
            this.settings_.activeConfigId = id;
            this.settings_.activePlatform = config.platform;
            this.notify();
        }
    }

    createConfig(platform: BuildPlatform, name: string): BuildConfig {
        const config = createDefaultBuildConfig(platform, name);
        this.addConfig(config);
        return config;
    }

    isLoaded(): boolean {
        return this.loaded_;
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let serviceInstance: BuildConfigService | null = null;

export function getBuildConfigService(projectDir?: string): BuildConfigService {
    if (!serviceInstance && projectDir) {
        serviceInstance = new BuildConfigService(projectDir);
    }
    if (!serviceInstance) {
        throw new Error('BuildConfigService not initialized');
    }
    return serviceInstance;
}

export function initBuildConfigService(projectDir: string): BuildConfigService {
    serviceInstance = new BuildConfigService(projectDir);
    return serviceInstance;
}
