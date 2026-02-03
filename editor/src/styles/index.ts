/**
 * @file    index.ts
 * @brief   Editor styles loader
 */

export const EDITOR_STYLES_URL = new URL('./editor.css', import.meta.url).href;

export function injectEditorStyles(): void {
    if (document.querySelector('link[data-es-editor-styles]')) {
        return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = EDITOR_STYLES_URL;
    link.setAttribute('data-es-editor-styles', 'true');
    document.head.appendChild(link);
}
