// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const absent = path.join(root, 'build', 'native-boot-no-template-fixture');
const run = (args: string[]) => spawnSync(process.execPath, [
    path.join(root, 'tools', 'verify-native-boot.mjs'),
    '--platform', 'android', '--template', absent,
    '--out', path.join(root, 'build', 'native-boot-prebuilt-review'), ...args,
], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, ANDROID_HOME: absent },
});

describe('native boot verification inputs', () => {
    it('can reach device verification for a prebuilt APK without a packaging template', () => {
        const result = run(['--apk', path.join(absent, 'game.apk')]);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('no android device or simulator is available');
        expect(result.stderr).not.toContain('runtime template');
    });

    it('still requires the runtime template when it must package examples', () => {
        const result = run(['--examples', 'all']);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('no android runtime template');
    });
});
