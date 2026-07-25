// UI Events — deliberately empty.
//
// Everything this project does is authored data: each button carries an
// `EventBinding` row ("on click, run ui.setPage with tabs:settings"), and the
// panel's colour + label are `UIGear`s reading the shared `tabs` controller.
// Open the scene, select a button, and look at the Details panel's Events
// section — that is the whole program.
//
// The tab buttons are deliberately authored differently: Home's rows carry the
// canonical string (`tabs:home`), Settings' carry named parameters. Both run the
// same action the same way — the registry projects between the forms — so data
// written before an action declared its parameters keeps working.
//
// "Start run" shows the ceiling and the way through it: a wire has no logic of
// its own, so the row fires a trigger and the `.esfsm` on the Hint entity decides
// what that means. Still no code — a state machine is data too.
//
// The entry point exists because a project has one; there is nothing to put in
// it. Wiring only needs code when it needs LOGIC, and then the row points at an
// action name (`fsm.fire`) instead of growing branches of its own.
export {};
