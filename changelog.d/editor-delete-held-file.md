---
section: Fixed
commits:
  - fix(editor): a delete the Recycle Bin refuses tries again a moment later, and then names the file or folder something holds open instead of the system's bare error
---
**Deleting an asset another program has open says which and why.** Deleting a file or folder in the Content Browser used to fail with "Error invoking remote method 'fs:trash': Error: Failed to perform delete operation" whenever something on Windows still had a file in it open. The editor now tries again for about a second (a virus scanner or the search indexer often holds a file just written), and if the file is still held, names it (or, where only its folder will not move, the folder) and says to close it in the program using it, such as a running game, a player or another editor.
