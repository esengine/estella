import { WebAudioBackend } from './WebAudioBackend';
import { WeChatAudioBackend } from './WeChatAudioBackend';
import type { PlatformAudioBackend } from './PlatformAudioBackend';
import { isWeChat } from '../platform/base';

export function createAudioBackend(): PlatformAudioBackend {
    if (isWeChat()) {
        return new WeChatAudioBackend();
    }
    return new WebAudioBackend();
}
