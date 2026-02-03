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

export interface NativeFS {
    readFile(path: string): Promise<string | null>;
    listDirectoryDetailed(path: string): Promise<DirectoryEntry[]>;
    exists(path: string): Promise<boolean>;
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
