---
section: Added
commits:
  - chore(editor): move the editor to the Content Browser's navigation bar, Settings menu and three views
  - feat(editor): Content Browser has a navigation bar, a Settings menu and Tiles / List / Columns views
---
**The Content Browser has a navigation bar, a Settings menu and three views.** The bar over the assets carries **Add**, **Import**, **Save all**, back and forward arrows, the path and **Settings**, the same in the docked panel and the Content Drawer; the type filter and the search sit on a row under it. **Settings** picks the view: **Tiles** (the thumbnail grid), **List** (a small thumbnail with the name and type on each row) or **Columns** (a table of type, size, dimensions and modified time that sorts from its header, either way round, and hides a column from the header's right-click menu). It also turns the folders and the folder tree on or off, lets a type filter reach into subfolders, chooses whether a search matches type names and asset paths, and sets the order. Names sort as numbers do, so `level2` comes before `level10`. The choices are kept per user.
