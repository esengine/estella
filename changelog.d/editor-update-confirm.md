---
section: Changed
commits:
  - fix(editor): confirm updates and never install over another copy
---
**Taking an editor update is asked first, and a copy kept beside the installed one is never replaced.** Download now opens a confirmation naming the running version, the new one and the folder the install replaces, and nothing is installed until Restart — closing the editor no longer installs a downloaded update on its way out. A copy run from a folder other than the installer's own (an older version kept for the projects pinned to it) links to the release page instead of installing into the registered folder. Settings ▸ General ▸ Updates shows the running and available versions, has Check for Updates, and turns the startup check off; a found update puts a red dot on the Settings button, the General page and Check for Updates.
