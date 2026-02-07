export function setEditorAPI(api: Record<string, unknown>): void {
    window.__ESENGINE_EDITOR__ = api;
}

export function clearEditorAPI(): void {
    delete window.__ESENGINE_EDITOR__;
}
