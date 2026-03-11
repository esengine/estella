/**
 * @file    index.ts
 * @brief   Dialog module exports
 */

export { Dialog } from './Dialog';
export { showDialog, showInputDialog, showObjectDialog, showConfirmDialog, showAlertDialog } from './presets';
export type { ObjectDialogOptions } from './presets';
export type {
    DialogRole,
    DialogButton,
    DialogOptions,
    DialogResult,
    InputDialogOptions,
    ConfirmDialogOptions,
    AlertDialogOptions,
} from './types';
