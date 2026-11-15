// Synthesised sound for Emberfall Arena.
//
// Every sound is built from WebAudio oscillators and noise — no audio
// files, no network. The context is created lazily on the first user
// gesture (browsers block audio before one), and M toggles mute. Repeated
// sounds vary slightly in pitch, so a long run never sounds mechanical.
//
// A quiet ambient pad starts with the first gesture and sits far under
// the action: it sets the night, it never competes with the shooting.

export function createSound() {
  let context = null;
  let muted = false;
  let noiseBuffer = null;
  let padGain = null;
  let padStarted = false;

  function ensure() {
    if (context) return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    const length = Math.floor(context.sampleRate * 0.3);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return context;
  }

  function startPad() {
    if (padStarted) return;
    const ctx = ensure();
    if (!ctx) return;
    padStarted = true;
    padGain = ctx.createGain();
    padGain.gain.value = muted ? 0 : 0.022;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    padGain.connect(filter).connect(ctx.destination);
    for (const [frequency, detune] of [[110, 0], [165, 4], [220, -5]]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      oscillator.connect(padGain);
      oscillator.start();
    }
    // A slow swell keeps the pad breathing instead of humming.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(padGain.gain);
    lfo.start();
  }

  function tone({ frequency, endFrequency, duration, type, volume, delay = 0, vary = 0 }) {
    if (muted) return;
    const ctx = ensure();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const pitch = vary > 0 ? 1 + (Math.random() * 2 - 1) * vary : 1;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency * pitch, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(endFrequency * pitch, 1), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function noise({ duration, volume, frequency }) {
    if (muted) return;
    const ctx = ensure();
    if (!ctx) return;
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  return {
    unlock() {
      const ctx = ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      startPad();
    },
    toggleMute() {
      muted = !muted;
      if (padGain && context) padGain.gain.setValueAtTime(muted ? 0 : 0.022, context.currentTime);
      return muted;
    },
    isMuted() {
      return muted;
    },
    shoot() {
      tone({ frequency: 880, endFrequency: 220, duration: 0.08, type: 'square', volume: 0.04, vary: 0.06 });
    },
    hit() {
      noise({ duration: 0.12, volume: 0.16, frequency: 1800 });
      tone({ frequency: 320, endFrequency: 90, duration: 0.12, type: 'sawtooth', volume: 0.08, vary: 0.05 });
    },
    kill() {
      tone({ frequency: 520, endFrequency: 130, duration: 0.16, type: 'triangle', volume: 0.12, vary: 0.08 });
      noise({ duration: 0.1, volume: 0.1, frequency: 2400 });
    },
    hurt() {
      tone({ frequency: 200, endFrequency: 55, duration: 0.35, type: 'sawtooth', volume: 0.18, vary: 0.05 });
      noise({ duration: 0.25, volume: 0.14, frequency: 900 });
    },
    pickup() {
      tone({ frequency: 660, endFrequency: 990, duration: 0.12, type: 'sine', volume: 0.12 });
      tone({ frequency: 990, endFrequency: 1320, duration: 0.14, type: 'sine', volume: 0.1, delay: 0.08 });
    },
    waveClear() {
      [523, 659, 784].forEach((frequency, index) => {
        tone({ frequency, duration: 0.18, type: 'triangle', volume: 0.11, delay: index * 0.09 });
      });
    },
    waveStart() {
      tone({ frequency: 392, endFrequency: 523, duration: 0.2, type: 'triangle', volume: 0.1 });
    },
    win() {
      [523, 659, 784, 1047, 1319].forEach((frequency, index) => {
        tone({ frequency, duration: 0.3, type: 'triangle', volume: 0.12, delay: index * 0.12 });
      });
    },
    lose() {
      [392, 330, 262, 196].forEach((frequency, index) => {
        tone({ frequency, duration: 0.32, type: 'sawtooth', volume: 0.09, delay: index * 0.16 });
      });
    },
  };
}
