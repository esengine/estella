// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { isNonContentPath } from '../assets/contentPolicy';
import { DEFAULT_LAYOUT, PROJECT_MANIFEST_FILE, type ProjectManifest, type ProjectPackaging, type WorkspaceState } from './format';

function projectPath(value: string): string | null {
    const path = value.replace(/\\/g, '/');
    if (path.startsWith('/') || /^[a-z][\w+.-]*:/i.test(path)) return null;
    const parts: string[] = [];
    for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) return null;
            parts.pop();
        } else parts.push(part);
    }
    return parts.join('/');
}

export function isProjectAssetMove(from: string, to: string): boolean {
    return [from, to].every(value => {
        const path = projectPath(value);
        return !!path && path !== PROJECT_MANIFEST_FILE && !isNonContentPath(path);
    });
}

/** A file or a whole folder can move. Compare complete project-relative path segments. */
export function remapAssetPath(value: string, from: string, to: string): string | null {
    const file = projectPath(value), old = projectPath(from), target = projectPath(to);
    if (!file || !old || !target || old === target || (file !== old && !file.startsWith(old + '/'))) return null;
    return target + file.slice(old.length);
}

type Move = (value: string) => string | null;
function remapExclusions<T extends { excludeScenes?: string[] }>(settings: T, move: Move): T {
    const paths = settings.excludeScenes;
    if (!Array.isArray(paths)) return settings;
    const next = paths.map(p => typeof p === 'string' ? move(p) ?? p : p);
    return next.some((p, i) => p !== paths[i]) ? { ...settings, excludeScenes: next } : settings;
}

function remapPackaging(packaging: ProjectPackaging, move: Move): ProjectPackaging {
    const next = remapExclusions(packaging, move);
    let changes: ProjectPackaging['profiles'];
    for (const [id, profile] of Object.entries(next.profiles ?? {})) {
        if (!profile || typeof profile !== 'object') continue;
        const updated = remapExclusions(profile, move);
        if (updated === profile) continue;
        changes ??= { ...next.profiles };
        changes[id] = updated;
    }
    return changes ? { ...next, profiles: changes } : next;
}

/** Used on the raw manifest on disk and the live project. Keep unrelated and future fields exactly as supplied. */
export function relocateSceneSettings<T extends Pick<ProjectManifest, 'defaultScene' | 'layout' | 'packaging'>>(
    project: T, from: string, to: string,
): T {
    const move: Move = p => remapAssetPath(p, from, to);
    const entry = typeof project.defaultScene === 'string' ? move(project.defaultScene) : null;
    const scenes = move(typeof project.layout?.scenes === 'string' ? project.layout.scenes : DEFAULT_LAYOUT.scenes);
    const packaging = project.packaging && remapPackaging(project.packaging, move);
    if (!entry && !scenes && packaging === project.packaging) return project;
    return { ...project, ...(entry ? { defaultScene: entry } : {}),
        ...(scenes ? { layout: { ...project.layout, scenes } } : {}),
        ...(packaging !== project.packaging ? { packaging } : {}) };
}

export function relocateWorkspace(workspace: WorkspaceState, from: string, to: string): WorkspaceState {
    const move = (p: unknown) => typeof p === 'string' ? remapAssetPath(p, from, to) : null;
    const last = move(workspace.lastOpenedScene), folder = move(workspace.contentBrowserPath);
    const remapDocument = (doc: NonNullable<WorkspaceState['activeDocument']>) => {
        const path = move(doc?.path);
        return path ? { ...doc, path } : doc;
    };
    const active = workspace.activeDocument && remapDocument(workspace.activeDocument);
    const open = Array.isArray(workspace.openDocuments) ? workspace.openDocuments.map(remapDocument) : undefined;
    const changedDocs = open?.some((doc, i) => doc !== workspace.openDocuments![i]);
    if (!last && !folder && active === workspace.activeDocument && !changedDocs) return workspace;
    return { ...workspace, ...(last ? { lastOpenedScene: last } : {}), ...(folder ? { contentBrowserPath: folder } : {}),
        ...(active !== workspace.activeDocument ? { activeDocument: active } : {}), ...(changedDocs ? { openDocuments: open } : {}) };
}
