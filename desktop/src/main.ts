/**
 * @file    main.ts
 * @brief   Desktop application entry point
 */

import '@esengine/editor/styles';
import { createEditor, ProjectLauncher } from '@esengine/editor';
import { injectNativeFS } from './native-fs';

let currentLauncher: ProjectLauncher | null = null;

async function showLauncher(container: HTMLElement): Promise<void> {
    currentLauncher = new ProjectLauncher(container, {
        onProjectOpen: (projectPath) => {
            currentLauncher?.dispose();
            currentLauncher = null;
            openEditor(container, projectPath);
        },
    });
}

function openEditor(container: HTMLElement, projectPath: string): void {
    const editor = createEditor(container, { projectPath });
    console.log('ESEngine Editor opened project:', projectPath, editor);
}

async function init(): Promise<void> {
    injectNativeFS();

    const container = document.getElementById('editor-root');
    if (!container) {
        console.error('Editor root container not found');
        return;
    }

    showLauncher(container);
}

init().catch(console.error);
