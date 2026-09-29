/** MkMk Street — Web Audio による SE / BGM */

const STORAGE_KEY = 'mkmk-street-vol';

function loadVol() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      master: clamp01(v.master ?? 0.7),
      bgm: clamp01(v.bgm ?? 0.35),
      se: clamp01(v.se ?? 0.8),
      muted: !!v.muted,
    };
  } catch {
    return { master: 0.7, bgm: 0.35, se: 0.8, muted: false };
  }
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

export function createAudio() {
  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  let seGain = null;
  let bgmTimer = null;
  let bgmStep = 0;
  const vol = loadVol();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    bgmGain = ctx.createGain();
    seGain = ctx.createGain();
    bgmGain.connect(masterGain);
    seGain.connect(masterGain);
    masterGain.connect(ctx.destination);
    applyVol();
    return ctx;
  }

  function applyVol() {
    if (!masterGain) return;
    masterGain.gain.value = vol.muted ? 0 : vol.master;
    bgmGain.gain.value = vol.bgm;
    seGain.gain.value = vol.se;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vol));
    } catch { /* ignore */ }
  }

  function resume() {
    const c = ensure();
    if (c?.state === 'suspended') c.resume();
  }

  function tone(freq, dur, type = 'sine', gain = 0.12, when = 0, dest = null) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest || seGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur = 0.08, gain = 0.08) {
    const c = ensure();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(seGain);
    src.start();
  }

  const SFX = {
    click() { tone(660, 0.06, 'triangle', 0.06); },
    dice() {
      noiseBurst(0.05, 0.1);
      tone(420, 0.05, 'square', 0.04, 0.02);
      tone(520, 0.05, 'square', 0.04, 0.07);
      tone(640, 0.08, 'square', 0.05, 0.12);
    },
    diceLand(face) {
      tone(300 + face * 40, 0.12, 'triangle', 0.1);
      tone(500 + face * 30, 0.18, 'sine', 0.06, 0.05);
    },
    step() {
      tone(220, 0.05, 'triangle', 0.05);
      noiseBurst(0.03, 0.04);
    },
    yourTurn() {
      tone(523, 0.12, 'sine', 0.1);
      tone(659, 0.14, 'sine', 0.1, 0.1);
      tone(784, 0.22, 'sine', 0.12, 0.22);
    },
    buy() {
      tone(523, 0.08, 'triangle', 0.08);
      tone(659, 0.1, 'triangle', 0.08, 0.08);
      tone(784, 0.16, 'triangle', 0.1, 0.16);
    },
    toll() {
      tone(180, 0.18, 'sawtooth', 0.05);
      tone(140, 0.22, 'sawtooth', 0.04, 0.1);
    },
    fork() {
      tone(440, 0.08, 'sine', 0.07);
      tone(554, 0.1, 'sine', 0.07, 0.08);
    },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, i * 0.12));
    },
    cancel() { tone(280, 0.08, 'triangle', 0.05); },
  };

  // やさしいペンタトニック循環
  const BGM_NOTES = [262, 294, 330, 392, 440, 392, 330, 294];

  function tickBgm() {
    if (!ctx || vol.muted) return;
    const note = BGM_NOTES[bgmStep % BGM_NOTES.length];
    tone(note, 0.35, 'sine', 0.045, 0, bgmGain);
    tone(note * 1.5, 0.3, 'triangle', 0.02, 0.02, bgmGain);
    bgmStep++;
  }

  function startBgm() {
    resume();
    if (bgmTimer) return;
    bgmStep = 0;
    tickBgm();
    bgmTimer = setInterval(tickBgm, 480);
  }

  function stopBgm() {
    if (bgmTimer) clearInterval(bgmTimer);
    bgmTimer = null;
  }

  return {
    resume,
    startBgm,
    stopBgm,
    sfx: SFX,
    getVolume() { return { ...vol } },
    setMaster(v) { vol.master = clamp01(v); applyVol(); },
    setBgm(v) { vol.bgm = clamp01(v); applyVol(); },
    setSe(v) { vol.se = clamp01(v); applyVol(); },
    setMuted(m) { vol.muted = !!m; applyVol(); },
    toggleMute() { vol.muted = !vol.muted; applyVol(); return vol.muted; },
  };
}
