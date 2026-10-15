// Objective audition of every bundled key. No playback or desktop access.
// node tools/demo/audit-keyboard.mjs <brag-assets> <review-directory>
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decode, RATE, db, peak, wav } from "./audio-utils.mjs";

const [assets, out] = process.argv.slice(2);
if (!assets || !out) throw new Error("Pass the brag assets root and a review directory");
await mkdir(out, { recursive: true });

// Radix-2 FFT, with a Hann window. Average power across all 2048-sample frames.
function spectrum(samples) {
  const n = 2048, power = new Float64Array(n / 2);
  for (let start = 0; start < samples.length; start += n / 2) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (samples[start + i] || 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)));
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [re[i], re[j]] = [re[j], re[i]];
    }
    for (let len = 2; len <= n; len *= 2) {
      for (let start = 0; start < n; start += len) {
        for (let j = 0; j < len / 2; j++) {
          const angle = -2 * Math.PI * j / len, a = start + j, b = a + len / 2;
          const r = re[b] * Math.cos(angle) - im[b] * Math.sin(angle);
          const v = re[b] * Math.sin(angle) + im[b] * Math.cos(angle);
          re[b] = re[a] - r; im[b] = im[a] - v; re[a] += r; im[a] += v;
        }
      }
    }
    for (let i = 0; i < power.length; i++) power[i] += re[i] ** 2 + im[i] ** 2;
  }
  const total = power.reduce((a, b) => a + b, 0);
  return {
    centroidHz: power.reduce((a, b, i) => a + b * i * RATE / n, 0) / total,
    highEnergyFraction: power.reduce((a, b, i) => a + (i * RATE / n >= 5000 ? b : 0), 0) / total,
  };
}
const rows = [], reel = new Float32Array(32 * RATE * .6);
for (let i = 1; i <= 32; i++) {
  const file = `keypress-${String(i).padStart(3, "0")}.wav`;
  const s = decode(resolve(assets, "sfx/keyboard", file)), p = peak(s);
  const windows = [];
  for (let k = 0; k < s.length; k += 240) {
    const block = s.subarray(k, k + 240);
    windows.push(Math.sqrt(block.reduce((a, b) => a + b * b, 0) / block.length));
  }
  let first = s.findIndex(v => Math.abs(v) >= p * .0126), last = s.length - 1;
  while (last > first && Math.abs(s[last]) < p * .0126) last--;
  const floor = [...windows].sort((a, b) => a - b)[Math.floor(windows.length * .1)];
  const rms = Math.sqrt(s.reduce((a, b) => a + b * b, 0) / s.length);
  const row = { file, durationMs: s.length / RATE * 1000, peakDb: db(p), rmsDb: db(rms),
    activeMs: (last - first + 1) / RATE * 1000, onsetMs: first / RATE * 1000,
    noiseFloorDb: db(floor), crestDb: db(p / rms), ...spectrum(s) };
  row.rejectedFor = [row.centroidHz >= 2850 && "sharp spectral centroid",
    row.noiseFloorDb >= -61 && "noisy quiet tail", row.crestDb >= 24.8 && "narrow click transient",
    row.peakDb >= -5 && "hard peak"].filter(Boolean);
  row.selected = row.rejectedFor.length === 0;
  rows.push(row);
  const gain = 10 ** (-16 / 20) / p;
  for (let k = 0; k < s.length; k++) reel[Math.round((i - 1) * .6 * RATE) + k] = s[k] * gain;
}
await writeFile(resolve(out, "keyboard-audit.json"), JSON.stringify({
  method: "48 kHz mono, 2048-point Hann FFT, power-weighted centroid; noise floor is the 10th percentile of 5 ms RMS windows including recorded quiet tails; active duration uses peak minus 38 dB",
  samples: rows,
}, null, 2) + "\n");
await wav(resolve(out, "keyboard-all-32-audition.wav"), reel, 1);
console.table(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v]))));
