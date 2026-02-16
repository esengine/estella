import { spawn } from 'child_process';
import os from 'os';
import * as logger from './logger.js';

const MIN_EMSCRIPTEN_VERSION = '3.1.51';

function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

export async function checkEmscripten() {
    try {
        const result = await runCommand('emcc', ['--version'], { silent: true });
        const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
        if (!versionMatch) {
            logger.error('Could not determine Emscripten version.');
            return false;
        }

        const version = versionMatch[1];
        logger.debug(`Emscripten version: ${version}`);

        if (compareVersions(version, MIN_EMSCRIPTEN_VERSION) < 0) {
            logger.error(`Emscripten ${version} is too old. Minimum required: ${MIN_EMSCRIPTEN_VERSION}`);
            logger.info(`  Update: emsdk install ${MIN_EMSCRIPTEN_VERSION} && emsdk activate ${MIN_EMSCRIPTEN_VERSION}`);
            logger.info('  Then: source /path/to/emsdk/emsdk_env.sh');
            return false;
        }

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
        logger.info('  Required version: 3.1.51');
        logger.info('  Install: emsdk install 3.1.51 && emsdk activate 3.1.51');
        logger.info('  Activate: source /path/to/emsdk/emsdk_env.sh');
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
