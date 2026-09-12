// The four drum pads, in pad order (also the keys 1-4).
export const PADS = [
    { name: 'Kick', url: 'assets/audio/kick.wav' },
    { name: 'Snare', url: 'assets/audio/snare.wav' },
    { name: 'Hi-Hat', url: 'assets/audio/hihat.wav' },
    { name: 'Clap', url: 'assets/audio/clap.wav' },
];

// Everything to preload up front so the first hit is latency-free. The beat's
// clip is not here: it is authored on the BeatBtn's AudioSource, so the scene
// brings it in and `beatSystem` reads which sound it is off the component.
export const ALL_URLS = PADS.map((p) => p.url);

// Bus volumes cycle through these steps on each click.
export const VOLUME_STEPS = [1, 0.66, 0.33, 0];

// Number of analyser bins the spectrum is sampled into (matches the bar count
// via BAR_STRIDE). Kept in one place so the system and scene agree.
export const SPECTRUM_BINS = 64;
export const BAR_STRIDE = 2;
