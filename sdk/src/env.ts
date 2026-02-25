let editorMode = false;
let playMode = false;

export function setEditorMode(active: boolean): void {
    editorMode = active;
}

export function isEditor(): boolean {
    return editorMode;
}

export function isRuntime(): boolean {
    return !editorMode;
}

export function setPlayMode(active: boolean): void {
    playMode = active;
}

export function isPlayMode(): boolean {
    return playMode;
}
