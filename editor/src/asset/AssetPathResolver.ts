/**
 * @file    AssetPathResolver.ts
 * @brief   Unified path resolution for editor assets
 */

import { getEditorContext } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';

export interface PathValidationResult {
    exists: boolean;
    error?: string;
}

export class AssetPathResolver {
    private projectDir_ = '';

    setProjectDir(dir: string): void {
        this.projectDir_ = this.normalizePath(dir);
    }

    getProjectDir(): string {
        return this.projectDir_;
    }

    toRelativePath(absolutePath: string): string {
        const normalized = this.normalizePath(absolutePath);
        if (!this.projectDir_) {
            return normalized;
        }

        if (normalized.startsWith(this.projectDir_)) {
            const relative = normalized.substring(this.projectDir_.length);
            return relative.startsWith('/') ? relative.substring(1) : relative;
        }

        return normalized;
    }

    toAbsolutePath(relativePath: string): string {
        const normalized = this.normalizePath(relativePath);
        if (this.isAbsolute(normalized)) {
            return normalized;
        }

        if (!this.projectDir_) {
            return normalized;
        }

        return `${this.projectDir_}/${normalized}`;
    }

    async validatePath(path: string): Promise<PathValidationResult> {
        const fs = this.getNativeFS();
        if (!fs) {
            return { exists: false, error: 'Native filesystem not available' };
        }

        const absolutePath = this.toAbsolutePath(path);

        try {
            if (typeof fs.exists === 'function') {
                const exists = await fs.exists(absolutePath);
                return { exists };
            }

            const content = await fs.readBinaryFile(absolutePath);
            return { exists: content !== null };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { exists: false, error: message };
        }
    }

    isAbsolute(path: string): boolean {
        const normalized = this.normalizePath(path);
        return normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized);
    }

    private normalizePath(path: string): string {
        return path.replace(/\\/g, '/');
    }

    private getNativeFS(): NativeFS | null {
        return getEditorContext().fs ?? null;
    }
}
