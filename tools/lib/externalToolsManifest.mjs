// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export const PLATFORMS = ['win-x64', 'linux-x64', 'linux-arm64', 'osx-x64', 'osx-arm64', 'any'];
const SHA = /^[0-9a-f]{64}$/;

/** What is wrong with the manifest as written, as sentences. Empty when it is fit to build from. */
export function manifestProblems(manifest, { requirePins = true } = {}) {
    const problems = [];
    if (manifest.formatVersion !== 1) problems.push(`formatVersion must be 1, not ${manifest.formatVersion}`);
    const tools = manifest.tools ?? {};
    for (const [id, tool] of Object.entries(tools)) {
        if (!/^[a-z][a-z0-9-]*$/.test(id)) problems.push(`tool id "${id}" must be lower-case letters, digits and hyphens`);
        if (typeof tool.version !== 'string' || !/^\d+(\.\d+)*$/.test(tool.version)) problems.push(`${id}: version "${tool.version}" is not a dotted number`);
        if (typeof tool.license !== 'string' || !tool.license) problems.push(`${id}: license is missing`);
        for (const need of tool.needs ?? []) if (!tools[need]) problems.push(`${id}: needs "${need}", which is not in the manifest`);
        const files = tool.files ?? {};
        if (Object.keys(files).length === 0) problems.push(`${id}: no files`);
        for (const [platform, file] of Object.entries(files)) {
            const where = `${id} ${platform}`;
            if (!PLATFORMS.includes(platform)) problems.push(`${where}: unknown platform`);
            const up = file.upstream;
            if (!up || typeof up.url !== 'string' || !up.url.startsWith('https://')) { problems.push(`${where}: upstream.url must be https`); continue; }
            if (up.bytes !== null && !(Number.isInteger(up.bytes) && up.bytes > 0)) problems.push(`${where}: upstream.bytes must be a positive integer`);
            if (up.sha256 !== null && !SHA.test(up.sha256 ?? '')) problems.push(`${where}: upstream.sha256 must be 64 hex digits`);
            if (requirePins && (up.bytes === null || up.sha256 === null)) problems.push(`${where}: not pinned yet — run tools/sync-external-tools.mjs --record`);
        }
        for (const [platform, exes] of Object.entries(tool.executables ?? {})) {
            if (!files[platform]) problems.push(`${id}: executables names ${platform}, which has no file`);
            if (!Array.isArray(exes) || exes.some((e) => typeof e !== 'string' || e.startsWith('/') || e.includes('..'))) problems.push(`${id} ${platform}: executables must be relative paths`);
        }
    }
    return problems;
}
