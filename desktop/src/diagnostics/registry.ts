// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry.ts
 * @brief   Who contributes what to a diagnostic bundle.
 *
 * @details The bundle must not be a function that lists its sources — a shape
 *          this repository has already been bitten by twice, most recently a
 *          native host restating a field list and dropping half of it. A
 *          subsystem registers what it can say; the exporter walks the registry.
 *
 *          On ContributionRegistry like every other extension point, so a section
 *          is owned and retractable, and a plugin contributes through the same
 *          door core uses.
 */
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';

export interface DiagnosticSection {
    /** Stable key this section appears under in the bundle: `engine`, `gpu`. */
    id: string;
    /**
     * Collect this section, or `null` when there is nothing to say — omitted
     * rather than written empty, since absent and empty are different facts.
     * Wrap the user's own content in `personal()`; a throw lands in the bundle's
     * `failedSections` and the other sections are still collected.
     */
    collect(): unknown;
}

class DiagnosticsRegistry {
    private readonly sections = new ContributionRegistry<DiagnosticSection>('diagnostic section');

    register(section: DiagnosticSection, owner: Owner = 'core'): Disposable {
        return this.sections.register(owner, section);
    }

    all(): DiagnosticSection[] {
        return [...this.sections.all()];
    }

    get(id: string): DiagnosticSection | undefined {
        return this.sections.get(id);
    }

    disposeOwner(owner: Owner): void {
        this.sections.disposeOwner(owner);
    }
}

export const diagnosticsRegistry = new DiagnosticsRegistry();
