// Dial Tone — channel spike
// Pure-JS channel simulators. They approximate what a phone call, a two-way
// radio or a speaker-to-mic hop does to a ggwave transmission.
// The same code runs in Node (sim-node.mjs) and in the browser (index.html).

export const SR = 48000;

// ---------- deterministic RNG (so runs are repeatable) ----------
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- building blocks ----------
// RBJ cookbook biquad, Q = 0.7071 (Butterworth section)
function biquad(x, type, f0, sr = SR, Q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f0) / sr, c = Math.cos(w), a = Math.sin(w) / (2 * Q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const v = (b0 * x[n] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[n]; y2 = y1; y1 = v; y[n] = v;
  }
  return y;
}
// 4th-order (two cascaded sections)
export const lowpass = (x, f, sr) => biquad(biquad(x, 'lp', f, sr), 'lp', f, sr);
export const highpass = (x, f, sr) => biquad(biquad(x, 'hp', f, sr), 'hp', f, sr);
export const bandpass = (x, lo, hi, sr) => lowpass(highpass(x, lo, sr), hi, sr);

// Linear-interpolation resampler (ratio = out/in)
export function resample(x, ratio) {
  const n = Math.floor(x.length * ratio), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i / ratio, k = Math.floor(p), f = p - k;
    y[i] = (x[k] || 0) * (1 - f) + (x[k + 1] || 0) * f;
  }
  return y;
}

// G.711 mu-law companding at 8 bits (what the old phone network did)
export function mulaw(x) {
  const mu = 255, y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    const c = Math.sign(v) * Math.log1p(mu * Math.abs(v)) / Math.log1p(mu);
    const q = Math.round(c * 127) / 127;
    y[i] = Math.sign(q) * (Math.pow(1 + mu, Math.abs(q)) - 1) / mu;
  }
  return y;
}

export function rms(x) {
  let s = 0, n = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-4) { s += x[i] * x[i]; n++; }
  return Math.sqrt(s / Math.max(n, 1));
}
// Noise is set relative to the TRANSMITTED level (ref), not what's left after
// filtering, so energy a channel strips out can't come back by rescaling.
export function addNoise(x, snrDb, r, ref = rms(x)) {
  const sigma = ref / Math.pow(10, snrDb / 20), y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + sigma * gauss(r);
  return y;
}
// FM radios hard-limit the audio; tanh is a gentle stand-in
export function softClip(x, drive) {
  const k = Math.tanh(drive), y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh(drive * x[i]) / k;
  return y;
}
// Cheap room: a few early reflections
export function room(x) {
  const taps = [[0, 1], [0.007, 0.45], [0.013, 0.3], [0.023, 0.2], [0.041, 0.12]];
  const y = new Float32Array(x.length);
  for (const [t, g] of taps) {
    const d = Math.round(t * SR);
    for (let i = d; i < x.length; i++) y[i] += g * x[i - d];
  }
  return y;
}
export function normalize(x, peak = 0.8) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  const g = m > 0 ? peak / m : 1, y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}
export function pad(x, sec = 0.6) {
  const p = Math.round(sec * SR), y = new Float32Array(x.length + 2 * p);
  y.set(x, p);
  return y;
}

// Radios filter the audio steeply and many (DMR/digital) run an 8 kHz audio path.
function radioPath(x, r, lo, hi, drive, snr) {
  const n = normalize(x, 0.5); // transmitter mic gain, applied before the band filter
  const band = bandpass(bandpass(n, lo, hi), lo, hi);
  const at8k = resample(band, 8000 / SR);
  const back = lowpass(resample(at8k, SR / 8000), 3600);
  return addNoise(softClip(back, drive), snr, r, rms(n));
}

// ---------- channels ----------
// Every channel takes a 48 kHz Float32Array and returns one.
export const CHANNELS = {
  clean: {
    label: 'Clean (baseline)',
    note: 'Encoder straight to decoder, plus a -60 dB noise floor like any real mic.',
    run: (x, r) => addNoise(x, 60, r),
  },
  room: {
    label: 'Room — phone speaker to phone mic, ~1.5 m',
    note: 'Speaker 300 Hz–17 kHz, reflections, 0.05% clock skew, SNR 15 dB.',
    run: (x, r) => addNoise(resample(room(bandpass(x, 300, 17000)), 0.9995), 15, r, rms(x)),
  },
  pstn: {
    label: 'Phone call — classic narrowband (G.711)',
    note: '300–3400 Hz, 8 kHz sampling, mu-law, SNR 25 dB. Does NOT model AMR/EVS speech codecs.',
    run: (x, r) => {
      const ref = rms(x);
      const band = bandpass(x, 300, 3400);
      const at8k = mulaw(resample(lowpass(band, 3600), 8000 / SR));
      return addNoise(lowpass(resample(at8k, SR / 8000), 3600), 25, r, ref);
    },
  },
  radio: {
    label: 'Walkie-talkie — good signal',
    note: 'Voice band 300–3000 Hz with steep (8th-order) filters, 8 kHz audio path, hard limiting, SNR 12 dB.',
    run: (x, r) => radioPath(x, r, 300, 3000, 3, 12),
  },
  radioWeak: {
    label: 'Walkie-talkie — weak signal',
    note: '400–2500 Hz, steep filters, 8 kHz audio path, heavier limiting, SNR 6 dB.',
    run: (x, r) => radioPath(x, r, 400, 2500, 5, 6),
  },
};

export const PROTOCOLS = [
  ['AUDIBLE_NORMAL', 'Audible · normal'],
  ['AUDIBLE_FAST', 'Audible · fast'],
  ['AUDIBLE_FASTEST', 'Audible · fastest'],
  ['DT_NORMAL', 'Dual-tone · normal'],
  ['DT_FAST', 'Dual-tone · fast'],
  ['DT_FASTEST', 'Dual-tone · fastest'],
  ['ULTRASOUND_NORMAL', 'Ultrasound · normal'],
  ['ULTRASOUND_FAST', 'Ultrasound · fast'],
  ['ULTRASOUND_FASTEST', 'Ultrasound · fastest'],
];

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:-';
export function randomMessage(r, len = 24) {
  let s = '';
  for (let i = 0; i < len; i++) s += CHARSET[Math.floor(r() * CHARSET.length)];
  return s;
}

// ---------- ggwave glue ----------
export function enableAllRx(gg) {
  for (const [id] of PROTOCOLS) gg.rxToggleProtocol(gg.ProtocolId['GGWAVE_PROTOCOL_' + id], 1);
}
export function newInstance(gg, sr = SR) {
  const p = gg.getDefaultParameters();
  p.sampleRateInp = sr;
  p.sampleRateOut = sr;
  return gg.init(p);
}
export function encode(gg, inst, text, protocolId, volume = 25) {
  const view = gg.encode(inst, text, gg.ProtocolId['GGWAVE_PROTOCOL_' + protocolId], volume);
  const bytes = new Int8Array(view); // copy out of wasm memory
  return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4).slice();
}
// Tries the decoder at several frame alignments (phases). Returns how many phases
// decoded `expected` (or any text if expected is omitted) and the first text found.
export function decodePhases(gg, samples, sr = SR, expected, phases = [0, 256, 512, 768]) {
  let ok = 0, text = null;
  for (const off of phases) {
    const inst = newInstance(gg, sr);
    const got = decode(gg, inst, samples.slice(off));
    gg.free(inst);
    if (got && (expected === undefined || got === expected)) { ok++; text = text || got; }
  }
  return { ok, of: phases.length, text };
}

// Feeds audio in 1024-sample chunks, like a live mic would. Returns the decoded text or null.
export function decode(gg, inst, samples, chunk = 1024) {
  for (let i = 0; i < samples.length; i += chunk) {
    const part = samples.slice(i, i + chunk);
    const res = gg.decode(inst, new Int8Array(part.buffer));
    if (res && res.length > 0) return new TextDecoder().decode(new Uint8Array(res).slice());
  }
  return null;
}
