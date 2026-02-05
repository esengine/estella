/**
 * @file    BuildHistory.ts
 * @brief   Build history tracking and management
 */

// =============================================================================
// Types
// =============================================================================

export type BuildStatus = 'success' | 'failed' | 'cancelled';

export interface BuildHistoryEntry {
    id: string;
    configId: string;
    configName: string;
    platform: string;
    timestamp: number;
    duration: number;
    status: BuildStatus;
    outputPath?: string;
    outputSize?: number;
    error?: string;
}

export interface BuildHistoryData {
    version: string;
    entries: BuildHistoryEntry[];
}

// =============================================================================
// Constants
// =============================================================================

const HISTORY_VERSION = '1.0';
const HISTORY_DIR = '.esengine';
const HISTORY_FILENAME = 'build-history.json';
const MAX_ENTRIES = 100;
const MAX_ENTRIES_PER_CONFIG = 20;

// =============================================================================
// BuildHistory Class
// =============================================================================

export class BuildHistory {
    private projectDir_: string;
    private entries_: BuildHistoryEntry[];
    private fs_: NativeFileSystem | null;
    private loaded_: boolean;

    constructor(projectDir: string) {
        this.projectDir_ = projectDir;
        this.entries_ = [];
        this.fs_ = window.__esengine_fs ?? null;
        this.loaded_ = false;
    }

    private getHistoryPath(): string {
        return `${this.projectDir_}/${HISTORY_DIR}/${HISTORY_FILENAME}`;
    }

    private getHistoryDir(): string {
        return `${this.projectDir_}/${HISTORY_DIR}`;
    }

    async load(): Promise<void> {
        if (!this.fs_) {
            this.loaded_ = true;
            return;
        }

        const historyPath = this.getHistoryPath();

        try {
            const content = await this.fs_.readFile(historyPath);
            const decoder = new TextDecoder();
            const jsonStr = decoder.decode(content);
            const data = JSON.parse(jsonStr) as BuildHistoryData;

            if (data.version === HISTORY_VERSION) {
                this.entries_ = data.entries;
            }
        } catch {
            this.entries_ = [];
        }

        this.loaded_ = true;
    }

    async save(): Promise<void> {
        if (!this.fs_) return;

        const historyDir = this.getHistoryDir();
        const historyPath = this.getHistoryPath();

        try {
            await this.fs_.mkdir(historyDir, { recursive: true });
        } catch {
            // Directory may already exist
        }

        const data: BuildHistoryData = {
            version: HISTORY_VERSION,
            entries: this.entries_,
        };

        const jsonStr = JSON.stringify(data, null, 2);
        const encoder = new TextEncoder();
        await this.fs_.writeFile(historyPath, encoder.encode(jsonStr));
    }

    addEntry(entry: Omit<BuildHistoryEntry, 'id'>): BuildHistoryEntry {
        const fullEntry: BuildHistoryEntry = {
            ...entry,
            id: `build-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        };

        this.entries_.unshift(fullEntry);
        this.pruneEntries();

        return fullEntry;
    }

    private pruneEntries(): void {
        if (this.entries_.length > MAX_ENTRIES) {
            this.entries_ = this.entries_.slice(0, MAX_ENTRIES);
        }

        const configCounts = new Map<string, number>();
        const keptEntries: BuildHistoryEntry[] = [];

        for (const entry of this.entries_) {
            const count = configCounts.get(entry.configId) || 0;
            if (count < MAX_ENTRIES_PER_CONFIG) {
                keptEntries.push(entry);
                configCounts.set(entry.configId, count + 1);
            }
        }

        this.entries_ = keptEntries;
    }

    getEntries(configId?: string): BuildHistoryEntry[] {
        if (configId) {
            return this.entries_.filter(e => e.configId === configId);
        }
        return [...this.entries_];
    }

    getLatest(configId: string): BuildHistoryEntry | undefined {
        return this.entries_.find(e => e.configId === configId);
    }

    getRecentBuilds(limit: number = 10): BuildHistoryEntry[] {
        return this.entries_.slice(0, limit);
    }

    getSuccessRate(configId?: string): number {
        const entries = configId
            ? this.entries_.filter(e => e.configId === configId)
            : this.entries_;

        if (entries.length === 0) return 0;

        const successCount = entries.filter(e => e.status === 'success').length;
        return (successCount / entries.length) * 100;
    }

    getAverageDuration(configId?: string): number {
        const entries = configId
            ? this.entries_.filter(e => e.configId === configId && e.status === 'success')
            : this.entries_.filter(e => e.status === 'success');

        if (entries.length === 0) return 0;

        const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);
        return totalDuration / entries.length;
    }

    clearHistory(configId?: string): void {
        if (configId) {
            this.entries_ = this.entries_.filter(e => e.configId !== configId);
        } else {
            this.entries_ = [];
        }
    }

    removeEntry(entryId: string): void {
        const index = this.entries_.findIndex(e => e.id === entryId);
        if (index !== -1) {
            this.entries_.splice(index, 1);
        }
    }

    isLoaded(): boolean {
        return this.loaded_;
    }
}

// =============================================================================
// Formatting Helpers
// =============================================================================

export function formatBuildTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) {
        return 'Just now';
    } else if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes} min ago`;
    } else if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
        const date = new Date(timestamp);
        return date.toLocaleDateString();
    }
}

export function formatBuildDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
}

export function getBuildStatusIcon(status: BuildStatus): string {
    switch (status) {
        case 'success':
            return '✓';
        case 'failed':
            return '✗';
        case 'cancelled':
            return '○';
    }
}

export function getBuildStatusClass(status: BuildStatus): string {
    switch (status) {
        case 'success':
            return 'build-status-success';
        case 'failed':
            return 'build-status-failed';
        case 'cancelled':
            return 'build-status-cancelled';
    }
}
