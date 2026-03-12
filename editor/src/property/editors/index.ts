import type { PropertyEditorFactory } from '../PropertyEditor';
import type { PluginRegistrar } from '../../container';
import { PROPERTY_EDITOR } from '../../container/tokens';
import { createUIRectEditor } from '../uiRectEditor';
import { createButtonTransitionEditor } from '../buttonTransitionEditor';

import { createNumberEditor } from './numberEditor';
import { createStringEditor } from './stringEditor';
import { createBooleanEditor } from './booleanEditor';
import { createVec2Editor, createVec3Editor, createVec4Editor, createPaddingEditor } from './vectorEditors';
import { createColorEditor } from './colorEditor';
import { createEulerEditor } from './eulerEditor';
import { createEnumEditor } from './enumEditor';
import { createTextureEditor } from './textureEditor';
import { createFontEditor } from './fontEditor';
import { createSpineFileEditor, createSpineAnimationEditor, createSpineSkinEditor } from './spineEditors';
import { createAssetFileEditor, ASSET_FILE_EDITORS } from './assetEditors';
import { createEntityEditor } from './entityEditor';
import { createVec2ArrayEditor, createStringArrayEditor } from './arrayEditors';
import { createCollisionLayerEditor } from './collisionLayerEditor';
import { createStateMachineEditor } from './stateMachineEditor';

export { getNativeFS, getProjectDir, getMimeType, navigateToAsset, handleAssetDrop, BROWSE_ICON, CLEAR_ICON } from './assetEditors';

export function registerBuiltinEditors(registrar: PluginRegistrar): void {
    const registerPropertyEditor = (type: string, factory: PropertyEditorFactory) => registrar.provide(PROPERTY_EDITOR, type, factory);
    console.log('[PropertyEditor] registerBuiltinEditors called');
    registerPropertyEditor('number', createNumberEditor);
    registerPropertyEditor('string', createStringEditor);
    registerPropertyEditor('boolean', createBooleanEditor);
    registerPropertyEditor('vec2', createVec2Editor);
    registerPropertyEditor('vec3', createVec3Editor);
    registerPropertyEditor('vec4', createVec4Editor);
    registerPropertyEditor('padding', createPaddingEditor);
    registerPropertyEditor('color', createColorEditor);
    registerPropertyEditor('enum', createEnumEditor);
    registerPropertyEditor('euler', createEulerEditor);
    registerPropertyEditor('texture', createTextureEditor);
    registerPropertyEditor('font', createFontEditor);
    registerPropertyEditor('spine-file', createSpineFileEditor);
    registerPropertyEditor('spine-animation', createSpineAnimationEditor);
    registerPropertyEditor('spine-skin', createSpineSkinEditor);
    for (const [editorType, config] of Object.entries(ASSET_FILE_EDITORS)) {
        registerPropertyEditor(editorType, (container, ctx) => createAssetFileEditor(container, ctx, config));
    }
    registerPropertyEditor('uirect', createUIRectEditor);
    registerPropertyEditor('button-transition', createButtonTransitionEditor);
    registerPropertyEditor('entity', createEntityEditor);
    registerPropertyEditor('string-array', createStringArrayEditor);
    registerPropertyEditor('vec2-array', createVec2ArrayEditor);
    registerPropertyEditor('collision-layer', createCollisionLayerEditor);
    registerPropertyEditor('state-machine', createStateMachineEditor);
}
