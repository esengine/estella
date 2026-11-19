---
section: Added
commits:
  - feat(timeline): a track path @Name animates what the playing TimelinePlayer binds that name to, anywhere in the scene
  - feat(editor): the Sequencer binds a track to any scene entity through the player, and the player's Details lists its bindings by name
---
**A timeline drives what its player binds.** A track whose path starts `@Name` animates the entity the playing `TimelinePlayer` binds that name to (its `bindingNames` and `bindings`), anywhere in the scene, with the rest of the path below it, as Unity's PlayableDirector bindings and UE's possessables do: a cutscene moves things that are not its children, and one timeline played by two players drives two different characters. Every kind of track can be bound, in play, in nested sequences and in the Sequencer's preview. The Sequencer's Track menu binds a new track to an entity outside the root in one undo step, and the player's Details lists its bindings by name to rebind; an entity list whose field names a `rowLabelsFrom` sibling is shown that way.
