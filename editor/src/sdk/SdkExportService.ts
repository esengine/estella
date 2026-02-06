/**
 * @file    SdkExportService.ts
 * @brief   Service for exporting SDK files to user projects
 */

import { SDK_VERSION } from '../types/ProjectTypes';

// =============================================================================
// Native FS Interface
// =============================================================================

interface NativeFS {
    createDirectory(path: string): Promise<boolean>;
    writeFile(path: string, content: string): Promise<boolean>;
    readFile(path: string): Promise<string | null>;
    getSdkEsmJs(): Promise<string>;
    getSdkEsmDts(): Promise<string>;
    getSdkWasmJs(): Promise<string>;
    getSdkWasmDts(): Promise<string>;
    getSdkWechatJs(): Promise<string>;
}

function getNativeFS(): NativeFS | null {
    return (window as any).__esengine_fs ?? null;
}

// =============================================================================
// SDK Export Service
// =============================================================================

export class SdkExportService {
    private fs_: NativeFS | null;

    constructor() {
        this.fs_ = getNativeFS();
    }

    async exportToProject(projectDir: string): Promise<boolean> {
        if (!this.fs_) {
            console.error('Native FS not available');
            return false;
        }

        const sdkDir = `${projectDir}/.esengine/sdk`;

        await this.fs_.createDirectory(`${projectDir}/.esengine`);
        await this.fs_.createDirectory(sdkDir);

        const results = await Promise.all([
            this.fs_.writeFile(`${sdkDir}/version.txt`, SDK_VERSION),
            this.fs_.writeFile(`${sdkDir}/index.js`, await this.fs_.getSdkEsmJs()),
            this.fs_.writeFile(`${sdkDir}/index.d.ts`, await this.fs_.getSdkEsmDts()),
            this.fs_.writeFile(`${sdkDir}/wasm.js`, await this.fs_.getSdkWasmJs()),
            this.fs_.writeFile(`${sdkDir}/wasm.d.ts`, await this.fs_.getSdkWasmDts()),
            this.fs_.writeFile(`${sdkDir}/index.wechat.js`, await this.fs_.getSdkWechatJs()),
        ]);

        return results.every(r => r);
    }

    async needsUpdate(projectDir: string): Promise<boolean> {
        if (!this.fs_) return true;

        const versionPath = `${projectDir}/.esengine/sdk/version.txt`;
        const content = await this.fs_.readFile(versionPath);
        if (!content) return true;

        return content.trim() !== SDK_VERSION;
    }
}
