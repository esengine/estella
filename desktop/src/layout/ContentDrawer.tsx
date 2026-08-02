// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Content Drawer — the Content Browser slides up over the workspace as a quick
// overlay (Ctrl+Space), on top of the docked Content Browser tab. Being a
// drawer is the shared paradigm's (components/OverlayDrawer.tsx); this is the
// head and the panel it summons.
import { FolderOpen, X } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { OverlayDrawer } from '@/components/OverlayDrawer';
import { ContentBrowser } from '@/panels/ContentBrowser';
import { t } from '@/i18n';

export function ContentDrawer() {
  const open = useEditorStore((s) => s.contentDrawer);
  const setOpen = useEditorStore((s) => s.setContentDrawer);
  const close = () => setOpen(false);

  return (
    <OverlayDrawer
      open={open}
      onClose={close}
      side="bottom"
      className="drawer--content"
      label={t('layout.panel.contentBrowser')}
    >
      <div className="drawer-head">
        <span className="drawer-title">
          <span className="ic">
            <FolderOpen size={16} strokeWidth={1.8} />
          </span>
          {t('layout.panel.contentBrowser')}
        </span>
        <span className="drawer-sp" />
        <button type="button" className="drawer-x" title={t('layout.closeEsc')} onClick={close}>
          <X size={15} strokeWidth={2} />
        </button>
      </div>
      <div className="drawer-body"><ContentBrowser /></div>
    </OverlayDrawer>
  );
}
