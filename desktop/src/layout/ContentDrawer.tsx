// Content Drawer — the Content Browser slides up over the workspace as a quick
// overlay (Ctrl+Space), on top of the docked Content Browser tab. Dismisses on
// outside click or Esc.
import { useEffect } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { ContentBrowser } from '@/panels/ContentBrowser';

export function ContentDrawer() {
  const open = useEditorStore((s) => s.contentDrawer);
  const setOpen = useEditorStore((s) => s.setContentDrawer);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <div className={`scrim${open ? ' open' : ''}`} onMouseDown={() => setOpen(false)}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="drawer-title">
            <span className="ic">
              <FolderOpen size={16} strokeWidth={1.8} />
            </span>
            Content Browser
          </span>
          <span className="drawer-sp" />
          <button type="button" className="drawer-x" title="Close (Esc)" onClick={() => setOpen(false)}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="drawer-body">{open && <ContentBrowser />}</div>
      </div>
    </div>
  );
}
