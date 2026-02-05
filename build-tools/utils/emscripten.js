import { spawn } from 'child_process';
import os from 'os';
import * as logger from './logger.js';

export async function checkEmscripten() {
    try {
        await runCommand('emcmake', ['--version'], { silent: true });
        return true;
    } catch {
        return false;
    }
}

export async function checkPython() {
    try {
        await runCommand('python3', ['--version'], { silent: true });
        return true;
    } catch {
        return false;
    }
}

export async function checkEnvironment() {
    const checks = {
        emscripten: await checkEmscripten(),
        python: await checkPython(),
    };

    if (!checks.emscripten) {
        logger.error('Emscripten not found. Please install and activate emsdk:');
        logger.info('  source /path/to/emsdk/emsdk_env.sh');
        return false;
    }

    if (!checks.python) {
        logger.error('Python 3 not found. Please install Python 3.');
        return false;
    }

    logger.debug('Environment check passed');
    return true;
}

export function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const { cwd, silent = false, env } = options;

        logger.debug(`Running: ${command} ${args.join(' ')}`);

        const proc = spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio: silent ? 'pipe' : 'inherit',
            shell: process.platform === 'win32',
        });

        let stdout = '';
        let stderr = '';

        if (silent) {
            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
        }

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr, code });
            } else {
                const error = new Error(`Command failed with code ${code}`);
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

export function getCpuCount() {
    return os.cpus().length;
}
