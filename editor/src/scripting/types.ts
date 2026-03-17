/**
 * @file    types.ts
 * @brief   Script compiler & loader type definitions
 */

import type * as esbuild from 'esbuild-wasm';

export type { NativeFS, DirectoryEntry, FileStats } from '../types/NativeFS';

// =============================================================================
// SDK Module Resolution
// =============================================================================

export type SdkModuleLoader = (path: string) => Promise<{ contents: string; loader: esbuild.Loader }>;

export type SdkResolveStrategy =
    | { type: 'shim'; modules: Map<string, Record<string, unknown>> }
    | { type: 'loader'; load: SdkModuleLoader; preferEsmEntry?: boolean };

// =============================================================================
// Compile Target
// =============================================================================

export interface CompileTarget {
    format: 'esm' | 'iife';
    sdk: SdkResolveStrategy;
    minify?: boolean;
    sourcemap?: boolean | 'inline';
    defines?: Record<string, string>;
}

// =============================================================================
// Compile Result & Errors
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

// =============================================================================
// Script Loader Options
// =============================================================================

export interface ScriptLoaderOptions {
    projectPath: string;
    onCompileError?: (errors: CompileError[]) => void;
    onCompileSuccess?: () => void;
}
