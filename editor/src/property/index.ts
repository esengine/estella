/**
 * @file    index.ts
 * @brief   Property editor exports
 */

export {
    type PropertyMeta,
    type PropertyEditorContext,
    type PropertyEditorFactory,
    type PropertyEditorInstance,
    registerPropertyEditor,
    getPropertyEditor,
    createPropertyEditor,
} from './PropertyEditor';

export { registerBuiltinEditors } from './editors';
export { registerMaterialEditors } from './materialEditors';
