---
section: Fixed
commits:
  - fix(editor): preferences are kept in a file in the user's profile, not the page's origin
---
**The editor no longer forgets its preferences after an update.** Settings, shortcuts, panel layouts and views, and what an AI agent may do were kept in the editor page's browser storage, which belongs to the local address the page is served from; whenever that address changed (an update starting while the old editor still held it, two editors at once) every preference came back to its default. They are now kept in one file in your user profile, as Unreal keeps its per-user settings, and what you had set is carried over the first time.
