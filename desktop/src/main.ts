/**
 * @file    main.ts
 * @brief   Desktop application entry point
 */

import '@esengine/editor/styles';
import { createEditor } from '@esengine/editor';
import { injectNativeFS } from './native-fs';

async function init() {
    injectNativeFS();

    const container = document.getElementById('editor-root');
    if (!container) {
        console.error('Editor root container not found');
        return;
    }

    const editor = createEditor(container);
    console.log('ESEngine Editor initialized', editor);
}

init().catch(console.error);
