#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import chalk from 'chalk';

// desktop/package.json is the single source of the desktop app version:
// electron-builder reads it, and the git tag mirrors it.
const PKG = 'desktop/package.json';

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
    console.log(`  e.g. node build-tools/release.js 0.14.1`);
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

// Soft reminder: the release should already be documented before we tag it.
const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes(`## [${version}]`)) {
    console.log(chalk.yellow('⚠'), `CHANGELOG.md has no "## [${version}]" entry — add release notes before publishing.`);
}

console.log(chalk.cyan('▸'), `Updating ${PKG} to ${version}`);
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const oldVersion = pkg.version;
if (oldVersion === version) {
    console.log(chalk.yellow('⚠'), `Version already ${version}, skipping file update`);
} else {
    pkg.version = version;
    writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
    run(`git add ${PKG}`);
    run(`git commit -m "chore: release v${version}"`);
}

console.log(chalk.cyan('▸'), `Creating tag v${version}`);
run(`git tag -a v${version} -m "v${version}"`);

console.log(chalk.cyan('▸'), 'Pushing to remote');
run('git push origin master');
run(`git push origin v${version}`);

console.log(chalk.green('\n✓'), `Released v${version}`);
console.log(chalk.gray('  CI will build and publish the desktop app.'));
