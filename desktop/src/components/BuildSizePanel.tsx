// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  BuildSizePanel.tsx — what the package weighs, after a build.
 *
 *        Answers the three questions in the order they get asked: does it fit,
 *        what is in it, and which file is the problem. The limit comes first
 *        because it is the only one with a wrong answer.
 *
 *        Everything here is DRAWN, not decided: the main process measured the
 *        build and judged it against the limits in force (see
 *        electron/sizeReport.ts), and this writes those verdicts as sentences in
 *        the editor's language — the split the export pipeline has always used,
 *        where the process with no locale reports facts and the dialog says them.
 *        A platform's own note ("WeChat caps a mini-game's main package at 4MB")
 *        is quoted as it was written, so it can be checked against that
 *        platform's docs rather than trusted.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { BuildSizeReport, SizeBucket, SizeKind } from '../../../pipeline/src/export/sizeReport';
import type { BudgetScope, SizeVerdict } from '../../../pipeline/src/project/sizeBudget';
import { formatBytes, PROJECT_BUDGET_NOTE } from '../../../pipeline/src/project/sizeBudget';
import { t } from '@/i18n';

const SCOPE_LABEL: Record<BudgetScope, () => string> = {
    initial: () => t('size.scope.initial'),
    total: () => t('size.scope.total'),
    deliverable: () => t('size.scope.deliverable'),
};

const KIND_LABEL: Record<SizeKind, () => string> = {
    engine: () => t('size.kind.engine'),
    scripts: () => t('size.kind.scripts'),
    texture: () => t('size.kind.texture'),
    audio: () => t('size.kind.audio'),
    video: () => t('size.kind.video'),
    font: () => t('size.kind.font'),
    scene: () => t('size.kind.scene'),
    data: () => t('size.kind.data'),
    other: () => t('size.kind.other'),
};

const BUCKET_LABEL: Record<SizeBucket, () => string> = {
    initial: () => t('size.bucket.initial'),
    lazy: () => t('size.bucket.lazy'),
    remote: () => t('size.bucket.remote'),
};

/** One limit, as a meter. Over-budget fills past the mark and says by how much —
 *  a bar pinned at 100% would hide the difference between 1% over and double. */
function BudgetMeter({ verdict }: { verdict: SizeVerdict }): React.ReactElement {
    const { budget, measuredBytes, ratio, status } = verdict;
    return (
        <div className={`size__budget is-${status}`}>
            <div className="size__budget-head">
                <span className="size__budget-scope">{SCOPE_LABEL[budget.scope]()}</span>
                <span className="size__budget-num selectable">
                    {t('size.ofLimit', { used: formatBytes(measuredBytes), max: formatBytes(budget.maxBytes) })}
                </span>
            </div>
            <div className="size__meter">
                <div className="size__meter-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </div>
            <div className="size__budget-note selectable">
                {status === 'over'
                    ? t('size.over', { by: formatBytes(measuredBytes - budget.maxBytes) })
                    : status === 'near' ? t('size.near', { pct: Math.round(ratio * 100) }) : null}
                {status !== 'ok' ? ' · ' : null}
                {budget.note === PROJECT_BUDGET_NOTE ? t('size.projectBudget') : budget.note}
            </div>
        </div>
    );
}

export function BuildSizePanel({ report }: { report: BuildSizeReport }): React.ReactElement {
    const [open, setOpen] = useState(false);
    // The composition bar is of the PACKAGE: CDN content is real, and is reported
    // beside it, but it is not what fills the thing being shipped.
    const total = report.packageBytes || 1;
    const buckets: { bucket: SizeBucket; bytes: number }[] = [
        { bucket: 'initial', bytes: report.initialBytes },
        { bucket: 'lazy', bytes: report.lazyBytes },
        { bucket: 'remote', bytes: report.remoteBytes },
    ];

    return (
        <div className="size">
            {report.verdicts.map((v, i) => <BudgetMeter key={i} verdict={v} />)}

            <div className="size__buckets">
                {buckets.filter((b) => b.bytes > 0).map((b) => (
                    <span key={b.bucket} className={`size__bucket is-${b.bucket}`}>
                        <span className="size__bucket-label">{BUCKET_LABEL[b.bucket]()}</span>
                        <span className="size__bucket-bytes selectable">{formatBytes(b.bytes)}</span>
                    </span>
                ))}
                {report.deliverableBytes != null && report.deliverableName && (
                    <span className="size__bucket is-deliverable">
                        <span className="size__bucket-label">{report.deliverableName}</span>
                        <span className="size__bucket-bytes selectable">{formatBytes(report.deliverableBytes)}</span>
                    </span>
                )}
            </div>

            {report.byKind.length > 0 && (
                <>
                    <div className="size__bar" role="img" aria-label={t('size.composition')}>
                        {report.byKind.map((k) => (
                            <span
                                key={k.kind}
                                className={`size__seg is-${k.kind}`}
                                style={{ width: `${(k.bytes / total) * 100}%` }}
                                title={`${KIND_LABEL[k.kind]()} · ${formatBytes(k.bytes)}`}
                            />
                        ))}
                    </div>
                    <div className="size__legend">
                        {report.byKind.map((k) => (
                            <span key={k.kind} className="size__legend-item">
                                <i className={`size__dot is-${k.kind}`} />
                                {KIND_LABEL[k.kind]()}
                                <span className="size__legend-bytes selectable">{formatBytes(k.bytes)}</span>
                            </span>
                        ))}
                    </div>
                </>
            )}

            {report.largest.length > 0 && (
                <div className="size__files">
                    <button type="button" className="size__disclose" onClick={() => setOpen(!open)} aria-expanded={open}>
                        <ChevronRight size={12} className={open ? 'size__chev is-open' : 'size__chev'} />
                        {t('size.largest', { count: report.fileCount })}
                    </button>
                    {open && (
                        <ol className="size__file-list selectable">
                            {report.largest.map((f) => (
                                <li key={f.path} className={`size__file is-${f.bucket}`}>
                                    <span className="size__file-path">{f.path}</span>
                                    <span className="size__file-bytes">{formatBytes(f.bytes)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}
        </div>
    );
}
