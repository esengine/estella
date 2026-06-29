// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { PLAY_PROTOCOL_VERSION, playProtocolMismatch } from '@/engine/playProtocol';

// RC10 P1: the editor↔play-realm version handshake. The realm reports its protocol
// version in `hello`; the editor refuses to proceed on a mismatch (a stale realm
// bundle) instead of failing obscurely on an unknown message shape.
describe('play protocol handshake', () => {
  it('accepts a matching protocol version', () => {
    expect(playProtocolMismatch(PLAY_PROTOCOL_VERSION)).toBeNull();
  });

  it('rejects an older/newer realm with a rebuild hint', () => {
    const older = playProtocolMismatch(PLAY_PROTOCOL_VERSION - 1);
    expect(older).not.toBeNull();
    expect(older).toContain('Rebuild');
    expect(playProtocolMismatch(PLAY_PROTOCOL_VERSION + 1)).not.toBeNull();
  });

  it('rejects a pre-handshake realm that reports no version', () => {
    // An old realm bundle (built before the handshake) sends `hello` with no
    // protocolVersion → undefined → mismatch, not a silent pass.
    expect(playProtocolMismatch(undefined)).not.toBeNull();
  });
});
