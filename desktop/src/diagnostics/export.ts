// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    export.ts
 * @brief   Collect, show what is about to leave, write it.
 *
 * @details The confirmation is not a formality. A bundle is something a studio
 *          hands to strangers, so the one decision that cannot be taken back —
 *          whether the user's own names and values travel with it — is made
 *          per export and in front of a summary, never remembered as a setting.
 */
import { collectBundle, serializeBundle, bundleFileName } from './bundle';
import type { DetailLevel } from './redact';
import { confirm } from '@/components/confirm';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

/** What the bundle turned out to hold, in one line the user reads before agreeing. */
function summarize(sections: Record<string, unknown>, failed: Record<string, string>): string {
    const names = Object.keys(sections);
    const failedNames = Object.keys(failed);
    const parts = [t('diag.summary.sections', { count: String(names.length), names: names.join(', ') })];
    if (failedNames.length > 0) parts.push(t('diag.summary.failed', { names: failedNames.join(', ') }));
    return parts.join('\n\n');
}

/**
 * Export a bundle at the given detail level.
 *
 * Collected BEFORE the prompt so the summary describes the real document rather
 * than a guess about it — and so a section that throws is visible while the user
 * still has the choice to send it anyway.
 */
export async function exportDiagnostics(detail: DetailLevel): Promise<void> {
    const bundle = collectBundle(detail, new Date().toISOString());
    const ok = await confirm({
        title: t(detail === 'full' ? 'diag.confirm.titleFull' : 'diag.confirm.title'),
        body: `${t(detail === 'full' ? 'diag.confirm.bodyFull' : 'diag.confirm.body')}\n\n${summarize(bundle.sections, bundle.failedSections)}`,
        confirmLabel: t('diag.confirm.export'),
        danger: detail === 'full',
    });
    if (!ok) return;

    const res = await window.estella?.app?.saveBundle?.(
        bundleFileName(bundle.createdAt), serializeBundle(bundle));
    if (!res || res.canceled) return;
    if (!res.ok) {
        Toasts.push(t('diag.failed', { error: res.error ?? '' }), 'error');
        return;
    }
    Toasts.push(t('diag.saved'), 'success', 8000, {
        label: t('diag.reveal'),
        run: () => void window.estella?.shell?.showItem?.(res.file!),
    });
}
