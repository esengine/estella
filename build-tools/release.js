#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import chalk from 'chalk';

// The root package.json is the engine's version; the git tag mirrors it. The
// editor keeps its own copy because electron-builder reads that one, and it is a
// submodule that may not be checked out — so it is mirrored, never required.
const PKG = 'package.json';
const EDITOR_PKG = 'desktop/package.json';

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

// The notes and the supported-versions table have to name this release. Checked
// again after the bump below by check-release-metadata (which `verify` runs), so
// this is the early, specific failure rather than the one at push time.
const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes(`## [${version}]`)) {
    die(`CHANGELOG.md has no "## [${version}]" entry — rename [Unreleased] before releasing.`);
}
if (!new RegExp(`^\\|\\s*${version.split('.').slice(0, 2).join('\\.')}\\.x\\s*\\|\\s*Yes\\s*\\|`, 'im')
        .test(readFileSync('SECURITY.md', 'utf8'))) {
    die(`SECURITY.md does not list ${version.split('.').slice(0, 2).join('.')}.x as supported.`);
}

console.log(chalk.cyan('▸'), `Updating ${PKG} to ${version}`);
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const oldVersion = pkg.version;
if (oldVersion === version) {
    console.log(chalk.yellow('⚠'), `Version already ${version}, skipping file update`);
} else {
    pkg.version = version;
    writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
    let staged = PKG;
    if (existsSync(EDITOR_PKG)) {
        const editor = JSON.parse(readFileSync(EDITOR_PKG, 'utf8'));
        editor.version = version;
        writeFileSync(EDITOR_PKG, JSON.stringify(editor, null, 2) + '\n');
        staged += ` ${EDITOR_PKG}`;
    }
    run(`git add ${staged}`);
    run(`git commit -m "chore: release v${version}"`);
}

console.log(chalk.cyan('▸'), `Creating tag v${version}`);
run(`git tag -a v${version} -m "v${version}"`);

console.log(chalk.cyan('▸'), 'Pushing to remote');
run('git push origin master');
run(`git push origin v${version}`);

console.log(chalk.green('\n✓'), `Released v${version}`);
console.log(chalk.gray('  CI will build and publish the desktop app.'));
