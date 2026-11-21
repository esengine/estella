---
section: Added
commits:
  - feat(editor): Content Browser filters stand in a bar, collections group assets, and the browser gets the height to show them
  - chore(editor): move the editor to Content Browser filters, collections and the taller browser
---
**Content Browser filters and collections.** The **Filters** menu puts a filter beside the search: a type, **Recently opened** (the last 20 assets opened in the project) or a **custom filter** you write once and keep in every project, with its own label, colour and filter string (the search's own syntax, such as `type:texture hero`). A click turns a filter off and leaves it in place, greyed; right-click it to remove it, enable only it, enable or disable all, or remove all the others. Filters add up, and the search narrows what they admit. **Collections**, under the folder tree, group assets without moving them: make one with **+**, nest them, drop assets on one or tick it under **Manage collections** in an asset's menu, and click it to see its assets alone. An asset added to a collection inside another is in both; renaming or moving an asset keeps it in its collections, and deleting a collection deletes no asset. Collections are kept on this machine, per project.

**More room for assets in the Content Browser.** Its navigation bar spans the whole panel and the filters share the search's row, the bottom dock starts at about a third of the window (Window ▸ Reset Layout takes it for a layout already saved), and a tile shows its name and type only, an image's size moving to its tooltip and the Columns view. A dock too low for a row of tiles lists the assets instead, and says so in its footer, until it is pulled up; a narrow dock keeps the Columns view to the name and one column.
