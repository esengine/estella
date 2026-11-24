---
section: Fixed
commits:
  - fix(editor): Project Health findings show in the editor's language
---
**Project Health speaks the editor's language.** In a Chinese editor the panel's group headings were translated but
every finding and every "could not be checked" reason was English. Each finding now carries its sentence as a message
key with its values, and the panel shows it in the editor's language; the report the editor MCP returns
(`get_project_health`) keeps its English wording, so automation reads the same text whatever language the editor is in.
