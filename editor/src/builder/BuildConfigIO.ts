/**
 * @file    BuildConfigIO.ts
 * @brief   Build configuration import/export functionality
 */

import { BuildConfig, BuildPlatform } from '../types/BuildTypes';
import { getEditorContext } from '../context/EditorContext';

// =============================================================================
// Types
// =============================================================================

export interface ExportedConfig {
    version: '1.0';
    exportedAt: string;
    configs: BuildConfig[];
}

export interface ImportResult {
    success: boolean;
    configs: BuildConfig[];
    errors: string[];
}

// =============================================================================
// Constants
// =============================================================================

const EXPORT_VERSION = '1.0';

// =============================================================================
// BuildConfigIO Class
// =============================================================================

export class BuildConfigIO {
    private fs_: import('../scripting/types').NativeFS | null;

    constructor() {
        this.fs_ = getEditorContext().fs ?? null;
    }

    async exportConfigs(configs: BuildConfig[], outputPath: string): Promise<void> {
        if (!this.fs_) {
            throw new Error('Native file system not available');
        }

        const exportData: ExportedConfig = {
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            configs: configs.map(config => this.sanitizeConfigForExport(config)),
        };

        await this.fs_.writeFile(outputPath, JSON.stringify(exportData, null, 2));
    }

    async importConfigs(filePath: string): Promise<ImportResult> {
        const result: ImportResult = {
            success: false,
            configs: [],
            errors: [],
        };

        if (!this.fs_) {
            result.errors.push('Native file system not available');
            return result;
        }

        try {
            const content = await this.fs_.readFile(filePath);
            if (!content) throw new Error('Empty file');
            const data = JSON.parse(content);

            if (!this.isValidExportFormat(data)) {
                result.errors.push('Invalid export file format');
                return result;
            }

            for (const config of data.configs) {
                const validation = this.validateConfig(config);
                if (validation.valid) {
                    const importedConfig = this.prepareConfigForImport(config);
                    result.configs.push(importedConfig);
                } else {
                    result.errors.push(`Config '${config.name || 'unknown'}': ${validation.error}`);
                }
            }

            result.success = result.configs.length > 0;
        } catch (err) {
            result.errors.push(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
        }

        return result;
    }

    exportConfigsToJson(configs: BuildConfig[]): string {
        const exportData: ExportedConfig = {
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            configs: configs.map(config => this.sanitizeConfigForExport(config)),
        };

        return JSON.stringify(exportData, null, 2);
    }

    importConfigsFromJson(jsonStr: string): ImportResult {
        const result: ImportResult = {
            success: false,
            configs: [],
            errors: [],
        };

        try {
            const data = JSON.parse(jsonStr);

            if (!this.isValidExportFormat(data)) {
                result.errors.push('Invalid export file format');
                return result;
            }

            for (const config of data.configs) {
                const validation = this.validateConfig(config);
                if (validation.valid) {
                    const importedConfig = this.prepareConfigForImport(config);
                    result.configs.push(importedConfig);
                } else {
                    result.errors.push(`Config '${config.name || 'unknown'}': ${validation.error}`);
                }
            }

            result.success = result.configs.length > 0;
        } catch (err) {
            result.errors.push(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
        }

        return result;
    }

    private isValidExportFormat(data: unknown): data is ExportedConfig {
        if (!data || typeof data !== 'object') return false;

        const obj = data as Record<string, unknown>;
        return (
            obj.version === EXPORT_VERSION &&
            typeof obj.exportedAt === 'string' &&
            Array.isArray(obj.configs)
        );
    }

    private validateConfig(config: unknown): { valid: boolean; error?: string } {
        if (!config || typeof config !== 'object') {
            return { valid: false, error: 'Invalid config object' };
        }

        const cfg = config as Record<string, unknown>;

        if (typeof cfg.name !== 'string' || !cfg.name) {
            return { valid: false, error: 'Missing or invalid name' };
        }

        if (!this.isValidPlatform(cfg.platform)) {
            return { valid: false, error: 'Invalid platform' };
        }

        if (!Array.isArray(cfg.scenes)) {
            return { valid: false, error: 'Missing scenes array' };
        }

        if (!Array.isArray(cfg.defines)) {
            return { valid: false, error: 'Missing defines array' };
        }

        return { valid: true };
    }

    private isValidPlatform(platform: unknown): platform is BuildPlatform {
        return platform === 'playable' || platform === 'wechat';
    }

    private sanitizeConfigForExport(config: BuildConfig): BuildConfig {
        return {
            id: config.id,
            name: config.name,
            platform: config.platform,
            scenes: [...config.scenes],
            defines: [...config.defines],
            playableSettings: config.playableSettings
                ? { ...config.playableSettings }
                : undefined,
            wechatSettings: config.wechatSettings
                ? { ...config.wechatSettings }
                : undefined,
        };
    }

    private prepareConfigForImport(config: BuildConfig): BuildConfig {
        return {
            ...config,
            id: `${config.platform}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        };
    }
}

// =============================================================================
// Download Helper (for browser)
// =============================================================================

export function downloadConfigsAsFile(configs: BuildConfig[], filename: string = 'build-configs.json'): void {
    const io = new BuildConfigIO();
    const jsonStr = io.exportConfigsToJson(configs);

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

export async function uploadConfigsFromFile(): Promise<ImportResult> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                resolve({
                    success: false,
                    configs: [],
                    errors: ['No file selected'],
                });
                return;
            }

            try {
                const text = await file.text();
                const io = new BuildConfigIO();
                resolve(io.importConfigsFromJson(text));
            } catch (err) {
                resolve({
                    success: false,
                    configs: [],
                    errors: [`Failed to read file: ${err instanceof Error ? err.message : String(err)}`],
                });
            }
        };

        input.oncancel = () => {
            resolve({
                success: false,
                configs: [],
                errors: ['Import cancelled'],
            });
        };

        input.click();
    });
}
