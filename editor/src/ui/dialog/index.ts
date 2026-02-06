/**
 * @file    index.ts
 * @brief   Dialog module exports
 */

export { Dialog } from './Dialog';
export { showDialog, showInputDialog, showConfirmDialog, showAlertDialog } from './presets';
export type {
    DialogRole,
    DialogButton,
    DialogOptions,
    DialogResult,
    InputDialogOptions,
    ConfirmDialogOptions,
    AlertDialogOptions,
} from './types';
