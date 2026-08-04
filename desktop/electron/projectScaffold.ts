// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The files every new project gets, whatever template it came from.
 *
 *        Generated at creation rather than kept in each template, because there
 *        are forty-odd templates — the blank starters plus every example — and a
 *        copy in each is a copy that drifts. The blank one's `.gitignore` proved
 *        it: it listed `dist/` while every export has long written
 *        `dist-<platform>/`, so a packaged game landed in git.
 *
 *        `package.json` is here because a project's scripts are bundled with
 *        esbuild, which resolves npm dependencies out of the project's own
 *        `node_modules` — so `npm install <a-library>` works and the library
 *        ships with the game, on every target. Without a package.json that
 *        starts with an `npm init` nobody would guess is a prerequisite.
 *
 *        Pure Node (fs), no electron — so it can be tested without one.
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * An npm-legal package name from a project's display name.
 *
 * "My Game" is a fine project name and an illegal package name — npm allows
 * lowercase, digits and `-._`, and refuses a leading `.` or `_`. A name with
 * nothing legal in it still yields something installable, rather than a
 * package.json npm refuses to read.
 */
export function npmPackageName(displayName: string): string {
    const slug = displayName
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+/, '')
        .replace(/[._-]+$/, '')
        .slice(0, 214);
    return slug || 'estella-game';
}

export const PROJECT_GITIGNORE = `node_modules/

# Export output — the Package dialog writes dist-<platform>/ per target.
dist/
dist-*/

# Editor-managed staging: the SDK types mirror, the play-realm build and the
# workspace are regenerated every time the editor opens the project.
.esengine/

.vscode/
.idea/
.DS_Store
Thumbs.db
`;

/**
 * Write the scaffold into an already-created project directory.
 *
 * Existing files are left alone: a template that ships its own on purpose keeps
 * it, and running this over a project twice changes nothing.
 */
export async function scaffoldProjectFiles(dest: string, name: string): Promise<void> {
    const packageJson = path.join(dest, 'package.json');
    if (!existsSync(packageJson)) {
        // `private` so an accidental `npm publish` cannot reach the registry, and
        // `type: module` to match the ESM the tsconfig template already targets.
        // No dependencies and no scripts: the editor builds the project, and npm
        // is here only so installing a library works without `npm init` first.
        await writeFile(packageJson, `${JSON.stringify({
            name: npmPackageName(name),
            version: '0.0.0',
            private: true,
            type: 'module',
        }, null, 2)}\n`);
    }
    const gitignore = path.join(dest, '.gitignore');
    if (!existsSync(gitignore)) await writeFile(gitignore, PROJECT_GITIGNORE);
}
