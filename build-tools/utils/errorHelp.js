import * as logger from './logger.js';

export class BuildError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'BuildError';
        this.context = context;
    }
}

export function suggestFix(error) {
    const message = error.message.toLowerCase();

    if (message.includes('emscripten') || message.includes('emcc') || message.includes('emcmake')) {
        return [
            'Emscripten not found or incorrect version.',
            'Run: emsdk install 3.1.51 && emsdk activate 3.1.51',
            'Then reload your shell: source path/to/emsdk/emsdk_env.sh',
        ];
    }

    if (message.includes('cmake')) {
        return [
            'CMake configuration or build failed.',
            'Try cleaning the build directory: node build-tools/cli.js clean',
            'Check CMakeLists.txt for syntax errors.',
        ];
    }

    if (message.includes('permission denied') || message.includes('eacces')) {
        return [
            'Permission denied.',
            'Try: sudo chmod -R u+w build*',
            'Or run with appropriate permissions.',
        ];
    }

    if (message.includes('no space left') || message.includes('enospc')) {
        return [
            'Disk space full.',
            'Free up disk space and try again.',
            'Clean old build artifacts: node build-tools/cli.js clean -a',
        ];
    }

    if (message.includes('wasm-opt')) {
        return [
            'wasm-opt optimization failed (non-critical).',
            'Install Binaryen for WASM optimization: brew install binaryen',
            'Or the build will continue without optimization.',
        ];
    }

    if (message.includes('node') && message.includes('not found')) {
        return [
            'Node.js not found.',
            'Install Node.js 18+ from https://nodejs.org/',
        ];
    }

    return null;
}

export function printErrorHelp(error) {
    const suggestions = suggestFix(error);

    if (suggestions) {
        logger.info('\n💡 Suggestions:');
        for (const suggestion of suggestions) {
            logger.info(`   ${suggestion}`);
        }
    }
}

export function handleBuildError(error, options = {}) {
    const { verbose = false, exit = true } = options;

    logger.error(`\n❌ Build failed: ${error.message}`);

    if (verbose && error.stack) {
        logger.debug('\nStack trace:');
        logger.debug(error.stack);
    }

    printErrorHelp(error);

    logger.info('\n📚 For more help:');
    logger.info('   - Check CONTRIBUTING.md for prerequisites');
    logger.info('   - Run with --verbose for detailed output');
    logger.info('   - Report issues at https://github.com/esengine/esengine/issues');

    if (exit) {
        process.exit(1);
    }
}
