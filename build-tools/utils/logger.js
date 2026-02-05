import chalk from 'chalk';
import ora from 'ora';

let verbose = false;
let spinner = null;

export function setVerbose(value) {
    verbose = value;
}

export function isVerbose() {
    return verbose;
}

export function info(message) {
    if (spinner) {
        spinner.stop();
    }
    console.log(chalk.blue('ℹ'), message);
    if (spinner) {
        spinner.start();
    }
}

export function success(message) {
    if (spinner) {
        spinner.stop();
    }
    console.log(chalk.green('✓'), message);
    if (spinner) {
        spinner.start();
    }
}

export function warn(message) {
    if (spinner) {
        spinner.stop();
    }
    console.log(chalk.yellow('⚠'), message);
    if (spinner) {
        spinner.start();
    }
}

export function error(message) {
    if (spinner) {
        spinner.stop();
    }
    console.log(chalk.red('✗'), message);
    if (spinner) {
        spinner.start();
    }
}

export function debug(message) {
    if (verbose) {
        if (spinner) {
            spinner.stop();
        }
        console.log(chalk.gray('  →'), chalk.gray(message));
        if (spinner) {
            spinner.start();
        }
    }
}

export function step(message) {
    if (spinner) {
        spinner.stop();
    }
    console.log(chalk.cyan('▸'), message);
    if (spinner) {
        spinner.start();
    }
}

export function startSpinner(message) {
    spinner = ora({
        text: message,
        color: 'cyan',
    }).start();
    return spinner;
}

export function stopSpinner(success = true, message = null) {
    if (spinner) {
        if (success) {
            spinner.succeed(message || spinner.text);
        } else {
            spinner.fail(message || spinner.text);
        }
        spinner = null;
    }
}

export function updateSpinner(message) {
    if (spinner) {
        spinner.text = message;
    }
}

export function header(title) {
    console.log('');
    console.log(chalk.bold.white(`═══ ${title} ═══`));
    console.log('');
}

export function divider() {
    console.log(chalk.gray('─'.repeat(50)));
}

export function printTime(startTime) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('');
    console.log(chalk.gray(`Done in ${elapsed}s`));
}
