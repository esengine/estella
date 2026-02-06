let editorMode = false;

export function setEditorMode(active: boolean): void {
    editorMode = active;
}

export function isEditor(): boolean {
    return editorMode;
}

export function isRuntime(): boolean {
    return !editorMode;
}
