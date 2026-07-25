// UI Events — deliberately empty.
//
// Everything this project does is authored data: each button carries an
// `EventBinding` row ("on click, run ui.setPage with tabs:settings"), and the
// panel's colour + label are `UIGear`s reading the shared `tabs` controller.
// Open the scene, select a button, and look at the Details panel's Events
// section — that is the whole program.
//
// The entry point exists because a project has one; there is nothing to put in
// it. Wiring only needs code when it needs LOGIC, and then the row points at an
// action name (`fsm.fire`) instead of growing branches of its own.
export {};
