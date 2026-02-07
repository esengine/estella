/**
 * @file    types.ts
 * @brief   Script loader type definitions
 */

export type { NativeFS, DirectoryEntry, FileStats } from '../types/NativeFS';

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
