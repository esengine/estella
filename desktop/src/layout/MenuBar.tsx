// Top menu bar. Draws the Estella mark and the classic menu set. The window is
// frameless (titleBarStyle: hiddenInset) so this strip doubles as the drag region.

const MENUS = ['File', 'Edit', 'Selection', 'View', 'Actor', 'Build', 'Window', 'Help'];

function Mark() {
  // The signature: a four-point starlight glyph — "Estella" = star.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 0.5 L9.4 6.6 L15.5 8 L9.4 9.4 L8 15.5 L6.6 9.4 L0.5 8 L6.6 6.6 Z"
        fill="var(--star)"
      />
      <circle cx="8" cy="8" r="1.1" fill="var(--void)" />
    </svg>
  );
}

export function MenuBar() {
  return (
    <div className="menubar">
      <div className="menubar__brand">
        <Mark />
        <span className="menubar__title">Estella</span>
      </div>
      <nav className="menubar__menus">
        {MENUS.map((m) => (
          <button key={m} className="menubar__item" type="button">
            {m}
          </button>
        ))}
      </nav>
      <div className="menubar__project">
        <span className="menubar__project-name">platformer</span>
        <span className="menubar__sep">/</span>
        <span className="menubar__scene mono">Level_01.scene</span>
      </div>
    </div>
  );
}
