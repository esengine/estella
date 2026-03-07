/**
 * @file    SdkExportService.ts
 * @brief   Service for exporting SDK files to user projects
 */

import { SDK_VERSION } from '../types/ProjectTypes';
import { getEditorContext } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
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
        const sharedDir = `${sdkDir}/shared`;
        const physicsDir = `${sdkDir}/physics`;
        const spineDir = `${sdkDir}/spine`;

        await this.fs_.createDirectory(`${projectDir}/.esengine`);
        await this.fs_.createDirectory(sdkDir);
        await this.fs_.createDirectory(sharedDir);
        await this.fs_.createDirectory(physicsDir);
        await this.fs_.createDirectory(spineDir);

        const results = await Promise.all([
            this.fs_.writeFile(`${sdkDir}/version.txt`, SDK_VERSION),
            this.fs_.writeFile(`${sdkDir}/index.js`, await this.fs_.getSdkEsmJs()),
            this.fs_.writeFile(`${sdkDir}/index.d.ts`, await this.fs_.getSdkEsmDts()),
            this.fs_.writeFile(`${sdkDir}/wasm.js`, await this.fs_.getSdkWasmJs()),
            this.fs_.writeFile(`${sdkDir}/wasm.d.ts`, await this.fs_.getSdkWasmDts()),
            this.fs_.writeFile(`${sdkDir}/index.wechat.js`, await this.fs_.getSdkWechatJs()),
            this.fs_.writeFile(`${sharedDir}/wasm.d.ts`, await this.fs_.getSdkSharedWasmDts()),
            this.fs_.writeFile(`${sharedDir}/app.d.ts`, await this.fs_.getSdkSharedAppDts()),
            this.fs_.writeFile(`${physicsDir}/index.d.ts`, await this.fs_.getSdkPhysicsDts()),
            this.fs_.writeFile(`${spineDir}/index.d.ts`, await this.fs_.getSdkSpineDts()),
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
