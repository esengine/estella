/**
 * @file    BuildHooks.ts
 * @brief   Build hook type definitions and executor
 */

import type { BuildHook, BuildHookPhase, CopyFilesConfig, RunCommandConfig } from '../types/BuildTypes';
import type { NativeFS } from '../types/NativeFS';
import { joinPath } from '../utils/path';
import type { BuildProgressReporter } from './BuildProgress';

// =============================================================================
// Hook Execution
// =============================================================================

export async function executeHooks(
    hooks: BuildHook[],
    phase: BuildHookPhase,
    projectDir: string,
    outputPath: string,
    fs: NativeFS,
    progress?: BuildProgressReporter,
): Promise<void> {
    const phaseHooks = hooks.filter(h => h.phase === phase);
    if (phaseHooks.length === 0) return;

    progress?.log('info', `Running ${phase}-build hooks (${phaseHooks.length})`);

    for (const hook of phaseHooks) {
        switch (hook.type) {
            case 'copy-files':
                await executeCopyFiles(hook.config as CopyFilesConfig, projectDir, outputPath, fs, progress);
                break;
            case 'run-command':
                await executeRunCommand(hook.config as RunCommandConfig, projectDir, fs, progress);
                break;
        }
    }
}

async function executeCopyFiles(
    config: CopyFilesConfig,
    projectDir: string,
    outputPath: string,
    fs: NativeFS,
    progress?: BuildProgressReporter,
): Promise<void> {
    const fromDir = resolveHookPath(config.from, projectDir, outputPath);
    const toDir = resolveHookPath(config.to, projectDir, outputPath);

    if (!await fs.exists(fromDir)) {
        progress?.log('warn', `Copy hook: source not found: ${fromDir}`);
        return;
    }

    await fs.createDirectory(toDir);
    await copyDirectoryRecursive(fs, fromDir, toDir, config.pattern);
    progress?.log('info', `Copied files: ${config.from} -> ${config.to}`);
}

async function copyDirectoryRecursive(
    fs: NativeFS,
    srcDir: string,
    destDir: string,
    pattern?: string,
): Promise<void> {
    const entries = await fs.listDirectoryDetailed(srcDir);

    for (const entry of entries) {
        const srcPath = joinPath(srcDir, entry.name);
        const destPath = joinPath(destDir, entry.name);

        if (entry.isDirectory) {
            await fs.createDirectory(destPath);
            await copyDirectoryRecursive(fs, srcPath, destPath, pattern);
        } else {
            if (pattern && !matchPattern(entry.name, pattern)) continue;
            const data = await fs.readBinaryFile(srcPath);
            if (data) {
                await fs.writeBinaryFile(destPath, data);
            }
        }
    }
}

function matchPattern(filename: string, pattern: string): boolean {
    const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(filename);
}

async function executeRunCommand(
    config: RunCommandConfig,
    projectDir: string,
    fs: NativeFS,
    progress?: BuildProgressReporter,
): Promise<void> {
    if (!fs.executeCommand) {
        progress?.log('warn', 'Run-command hook: shell execution not available');
        return;
    }

    const args = config.args ?? [];
    progress?.log('info', `Running: ${config.command} ${args.join(' ')}`);

    try {
        const result = await fs.executeCommand(config.command, args, projectDir);
        if (result.exitCode !== 0) {
            progress?.log('warn', `Command exited with code ${result.exitCode}: ${result.stderr || result.stdout}`);
        } else if (result.stdout) {
            progress?.log('info', result.stdout.substring(0, 200));
        }
    } catch (err) {
        progress?.log('error', `Command failed: ${err}`);
        throw err;
    }
}

function resolveHookPath(hookPath: string, projectDir: string, outputPath: string): string {
    return hookPath
        .replace('${projectDir}', projectDir)
        .replace('${outputPath}', outputPath)
        .replace('${outputDir}', outputPath.substring(0, outputPath.lastIndexOf('/')));
}

// =============================================================================
// Hook Validation
// =============================================================================

export function validateHook(hook: BuildHook): string | null {
    if (!hook.phase || (hook.phase !== 'pre' && hook.phase !== 'post')) {
        return 'Invalid hook phase: must be "pre" or "post"';
    }

    if (hook.type === 'copy-files') {
        const config = hook.config as CopyFilesConfig;
        if (!config.from) return 'Copy hook: "from" path is required';
        if (!config.to) return 'Copy hook: "to" path is required';
    } else if (hook.type === 'run-command') {
        const config = hook.config as RunCommandConfig;
        if (!config.command) return 'Run hook: "command" is required';
    } else {
        return `Unknown hook type: ${hook.type}`;
    }

    return null;
}

export function createDefaultHook(type: BuildHook['type'], phase: BuildHookPhase): BuildHook {
    if (type === 'copy-files') {
        return {
            phase,
            type: 'copy-files',
            config: { from: '${outputDir}', to: '' } as CopyFilesConfig,
        };
    }
    return {
        phase,
        type: 'run-command',
        config: { command: '', args: [] } as RunCommandConfig,
    };
}
