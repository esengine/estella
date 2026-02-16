#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import chalk from 'chalk';

const TAURI_CONF = 'desktop/src-tauri/tauri.conf.json';

function run(cmd) {
    console.log(chalk.gray(`  $ ${cmd}`));
    try {
        execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        die(`Command failed: ${cmd}`);
    }
}

function die(msg) {
    console.error(chalk.red('✗'), msg);
    process.exit(1);
}

const version = process.argv[2];
if (!version) {
    console.log(`Usage: node build-tools/release.js <version>`);
    console.log(`  e.g. node build-tools/release.js 0.4.3`);
    process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
    die(`Invalid version format: "${version}". Expected x.y.z`);
}

const status = execSync('git status --porcelain').toString().trim();
if (status) {
    die('Working tree is not clean. Commit or stash changes first.');
}

console.log(chalk.bold.white(`\n═══ Release v${version} ═══\n`));

console.log(chalk.cyan('▸'), `Updating ${TAURI_CONF} to ${version}`);
const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
const oldVersion = conf.version;
if (oldVersion === version) {
    console.log(chalk.yellow('⚠'), `Version already ${version}, skipping file update`);
} else {
    conf.version = version;
    writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + '\n');
    run(`git add ${TAURI_CONF}`);
    run(`git commit -m "chore: bump desktop version to ${version}"`);
}

console.log(chalk.cyan('▸'), `Creating tag v${version}`);
run(`git tag -a v${version} -m "v${version}"`);

console.log(chalk.cyan('▸'), 'Pushing to remote');
run('git push origin master');
run(`git push origin v${version}`);

console.log(chalk.green('\n✓'), `Released v${version}`);
console.log(chalk.gray('  CI will build and publish the desktop app.'));
