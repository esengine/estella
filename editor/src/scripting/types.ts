/**
 * @file    types.ts
 * @brief   Script loader type definitions
 */

// =============================================================================
// Native FS Interface
// =============================================================================

export interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
}

export interface FileStats {
    size: number;
    modified: Date | null;
    created: Date | null;
}

export interface NativeFS {
    saveFile(content: string, defaultPath?: string): Promise<string | null>;
    loadFile(): Promise<{ path: string; content: string } | null>;
    selectDirectory(): Promise<string | null>;
    createDirectory(path: string): Promise<boolean>;
    exists(path: string): Promise<boolean>;
    writeFile(path: string, content: string): Promise<boolean>;
    writeBinaryFile(path: string, data: Uint8Array): Promise<boolean>;
    readFile(path: string): Promise<string | null>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
    copyFile(src: string, dest: string): Promise<boolean>;
    getFileStats(path: string): Promise<FileStats | null>;
    openProject(): Promise<string | null>;
    listDirectory(path: string): Promise<string[]>;
    listDirectoryDetailed(path: string): Promise<DirectoryEntry[]>;
    watchDirectory(
        path: string,
        callback: (event: { type: 'create' | 'modify' | 'remove' | 'rename' | 'any'; paths: string[] }) => void,
        options?: { recursive?: boolean }
    ): Promise<() => void>;
    openFolder(path: string): Promise<boolean>;
    openFile?(path: string): Promise<void>;
    showOpenDialog?(options: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string[] | null>;
    getResourcePath(): Promise<string>;
    getEngineJs(): Promise<string>;
    getEngineWasm(): Promise<Uint8Array>;
    getEngineSingleJs(): Promise<string>;
    getEngineWxgameJs(): Promise<string>;
    getEngineWxgameWasm(): Promise<Uint8Array>;
    getSdkWechatJs(): Promise<string>;
    getSdkEsmJs(): Promise<string>;
    getSdkEsmDts(): Promise<string>;
    getSdkWasmJs(): Promise<string>;
    getSdkWasmDts(): Promise<string>;
    getEditorDts(): Promise<string>;
    toAssetUrl?(path: string): string;
}

// =============================================================================
// Script Loader Types
// =============================================================================

export interface CompileResult {
    success: boolean;
    code?: string;
    errors?: CompileError[];
}

export interface CompileError {
    file: string;
    line: number;
    column: number;
    message: string;
}

export interface ScriptLoaderOptions {
    projectPath: string;
    onCompileError?: (errors: CompileError[]) => void;
    onCompileSuccess?: () => void;
}
