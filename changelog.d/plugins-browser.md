---
section: Changed
commits:
  - feat(editor): the Plugins window lists plugins as Unreal's Plugins browser does
  - feat(plugins): built-in plugins name their category
---
**The Plugins window is laid out like Unreal's Plugins browser.** It opens as a tab beside the Viewport. On the left a tree counts every plugin under All Plugins, anything that needs attention (failed, waiting for approval), and Project, Installed and Built-in, each split by category; on the right each plugin is a card with an enable box, its icon, name and description, its version and publisher, and Edit, Package, Show in Folder, Reload and Details. Search marks what it matched. A plugin's `plugin.json` can now give a `category`, an `icon`, a `docsUrl` and `"beta": true`, as an Unreal `.uplugin` does.
