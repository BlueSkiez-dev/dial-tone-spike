// Usage: node sim-node.mjs <path-to-ggwave.js> [trials]
// Runs every ggwave protocol through every simulated channel and prints a success table.
import { createRequire } from 'node:module';
import { CHANNELS, PROTOCOLS, SR, rng, randomMessage, enableAllRx, newInstance, encode, decode, pad } from './channels.js';

const ggPath = process.argv[2];
const trials = Number(process.argv[3] || 10);
if (!ggPath) { console.error('Pass the path to ggwave.js'); process.exit(1); }
const factory = createRequire(import.meta.url)(ggPath);
const gg = await factory();
gg.disableLog();
enableAllRx(gg);

const silence = console.log; // ggwave's encode() printf()s; mute it while running
const results = {};
for (const [pid, plabel] of PROTOCOLS) {
  results[pid] = { label: plabel, secs: 0 };
  for (const ch of Object.keys(CHANNELS)) {
    const r = rng(1234);
    let ok = 0, secs = 0;
    for (let t = 0; t < trials; t++) {
      const msg = randomMessage(r);
      console.log = () => {};
      const tx = newInstance(gg);
      const wave = encode(gg, tx, msg, pid);
      gg.free(tx);
      const rxi = newInstance(gg);
      const got = decode(gg, rxi, CHANNELS[ch].run(pad(wave), r));
      gg.free(rxi);
      console.log = silence;
      secs = wave.length / SR;
      if (got === msg) ok++;
    }
    results[pid][ch] = ok;
    results[pid].secs = secs;
  }
}

const chs = Object.keys(CHANNELS);
const pct = (n) => `${Math.round((100 * n) / trials)}%`.padStart(5);
console.log(`\n${trials} random 24-character messages per cell\n`);
console.log('protocol'.padEnd(22) + 'sec/msg ' + chs.map((c) => c.padStart(10)).join(''));
for (const [pid] of PROTOCOLS) {
  const row = results[pid];
  console.log(row.label.padEnd(22) + row.secs.toFixed(1).padStart(6) + '  ' + chs.map((c) => pct(row[c]).padStart(10)).join(''));
}
console.log(JSON.stringify({ trials, results }));
