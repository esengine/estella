/**
 * @file    EditorExportService.ts
 * @brief   Export editor type definitions to user projects
 */

import { SDK_VERSION } from '../types/ProjectTypes';
import { getEditorContext } from '../context/EditorContext';

// =============================================================================
// Native FS Interface
// =============================================================================

interface NativeFS {
    createDirectory(path: string): Promise<boolean>;
    exists(path: string): Promise<boolean>;
    writeFile(path: string, content: string): Promise<boolean>;
    readFile(path: string): Promise<string | null>;
    getEditorDts(): Promise<string>;
}

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

// =============================================================================
// Editor Export Service
// =============================================================================

export class EditorExportService {
    private fs_: NativeFS | null;

    constructor() {
        this.fs_ = getNativeFS();
    }

    async exportToProject(projectDir: string): Promise<boolean> {
        if (!this.fs_) return false;

        const editorDir = `${projectDir}/.esengine/editor`;

        await this.fs_.createDirectory(`${projectDir}/.esengine`);
        await this.fs_.createDirectory(editorDir);

        const results = await Promise.all([
            this.fs_.writeFile(`${editorDir}/version.txt`, SDK_VERSION),
            this.fs_.writeFile(`${editorDir}/index.d.ts`, await this.fs_.getEditorDts()),
        ]);

        return results.every(r => r);
    }

    async needsUpdate(projectDir: string): Promise<boolean> {
        if (!this.fs_) return true;

        const versionPath = `${projectDir}/.esengine/editor/version.txt`;
        if (!(await this.fs_.exists(versionPath))) return true;

        const content = await this.fs_.readFile(versionPath);
        if (!content) return true;

        return content.trim() !== SDK_VERSION;
    }
}
