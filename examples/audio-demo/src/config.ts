// The four drum pads, in pad order (also the keys 1-4).
export const PADS = [
    { name: 'Kick', url: 'assets/audio/kick.wav' },
    { name: 'Snare', url: 'assets/audio/snare.wav' },
    { name: 'Hi-Hat', url: 'assets/audio/hihat.wav' },
    { name: 'Clap', url: 'assets/audio/clap.wav' },
];

// The looping beat runs on the music bus. There's no dedicated music track in
// this example, so a kick loop stands in — enough to show playBGM's loop + fade
// + music-bus routing.
export const BEAT_URL = 'assets/audio/kick.wav';

// Everything to preload up front so the first hit is latency-free.
export const ALL_URLS = [...PADS.map((p) => p.url), BEAT_URL];

// Bus volumes cycle through these steps on each click.
export const VOLUME_STEPS = [1, 0.66, 0.33, 0];

// Number of analyser bins the spectrum is sampled into (matches the bar count
// via BAR_STRIDE). Kept in one place so the system and scene agree.
export const SPECTRUM_BINS = 64;
export const BAR_STRIDE = 2;
