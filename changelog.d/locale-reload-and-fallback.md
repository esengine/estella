---
section: Fixed
commits:
  - perf(i18n): resolve updated translations without rebuilding every language
  - fix(editor): preserve preview translations when a string table cannot reload
---
**Updating a translation refreshes live labels without rebuilding every language's dictionary.** Plural translations supplied by the fallback language use its own rule. If a string table becomes unreadable, the editor keeps its last valid translations in the preview and shows the affected files in the String Table. Healthy files remain editable. You can export the readable tables with their file paths and resume importing when the files are repaired.
