/**
 * @file    sampleTimeline.ts
 * @brief   A built-in sample .estimeline for skeleton verification (DEV ONLY).
 *
 * Lets the Sequencer render a real track tree before the Content Browser "open
 * .estimeline" flow lands (P2). Remove once opening real clips is wired.
 */

import { parseTimelineAsset, type TimelineAsset } from 'esengine';

const RAW = {
  version: '1.1',
  type: 'timeline',
  duration: 2.0,
  wrapMode: 'loop',
  tracks: [
    {
      type: 'property',
      name: 'Move',
      childPath: '',
      component: 'Transform',
      channels: [
        {
          property: 'position.x',
          keyframes: [
            { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: 'linear' },
            { time: 1, value: 120, inTangent: 0, outTangent: 0, interpolation: 'easeInOut' },
            { time: 2, value: 0, inTangent: 0, outTangent: 0, interpolation: 'linear' },
          ],
        },
        {
          property: 'position.y',
          keyframes: [
            { time: 0, value: 0, inTangent: 0, outTangent: 0 },
            { time: 1, value: 60, inTangent: 0, outTangent: 0 },
            { time: 2, value: 0, inTangent: 0, outTangent: 0 },
          ],
        },
        {
          property: 'rotation.z',
          keyframes: [
            { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: 'linear' },
            { time: 2, value: Math.PI * 2, inTangent: 0, outTangent: 0, interpolation: 'linear' },
          ],
        },
      ],
    },
    {
      type: 'property',
      name: 'Fade',
      childPath: '',
      component: 'Sprite',
      channels: [
        {
          property: 'color.a',
          keyframes: [
            { time: 0, value: 1, inTangent: 0, outTangent: 0 },
            { time: 1, value: 0.2, inTangent: 0, outTangent: 0 },
            { time: 2, value: 1, inTangent: 0, outTangent: 0 },
          ],
        },
      ],
    },
    {
      type: 'audio',
      name: 'Step',
      childPath: '',
      events: [{ time: 0.5, clip: 'sfx/step.mp3', volume: 0.8 }],
    },
  ],
};

export function sampleTimelineAsset(): TimelineAsset {
  // Parse a fresh copy each call so edits don't mutate the shared literal.
  return parseTimelineAsset(JSON.parse(JSON.stringify(RAW)));
}
