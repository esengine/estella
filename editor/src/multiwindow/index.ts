export { RemoteEditorStore } from './RemoteEditorStore';
export { MainWindowBridge } from './MainWindowBridge';
export { WindowManager } from './WindowManager';

export {
    CHANNEL_STATE,
    CHANNEL_ACTION,
    CHANNEL_ACTION_RESULT,
    CHANNEL_PANEL_OPENED,
    CHANNEL_PANEL_CLOSED,
    CHANNEL_OUTPUT,
    type SerializedEditorState,
    type ActionType,
    type ActionMessage,
    type ActionResultMessage,
    type PanelOpenedMessage,
    type PanelClosedMessage,
    type OutputType,
    type OutputMessage,
} from './protocol';

export { serializeEditorState } from './stateSerializer';
