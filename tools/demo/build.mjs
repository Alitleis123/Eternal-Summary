// Cursor schedule and deterministic SFX from the recorded action log.
// node tools/demo/build.mjs
// Then node tools/demo/mix.mjs to replace audio without re-encoding picture.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { decode, RATE, DURATION, amp, db, peak, random, wav, run } from "./audio-utils.mjs";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const OUT = resolve(DIR, "generated");
await mkdir(OUT, { recursive: true });
const log = JSON.parse(await readFile(resolve(OUT, "action-log.json"), "utf8"));
await writeFile(resolve(OUT, "actions.js"), `window.demoActions = ${JSON.stringify(log.actions)};\n`);
// The focus blur filters its own copy of the footage. A separate file keeps
// Hyperframes from discovering one video twice. It is only ever seen
// blurred and dimmed, so half resolution keeps PNG frame extraction light.
run(["-v", "error", "-y", "-i", resolve(OUT, "usage.mp4"), "-vf", "scale=1680:946:flags=lanczos",
  "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-pix_fmt", "yuv420p", "-an", resolve(OUT, "usage-soft.mp4")]);
const rng = random(0x45534b34);
const keyName = n => `keypress-${String(n).padStart(3, "0")}.wav`;
// All 32 were measured. These pass centroid < 2850 Hz, noise floor < -61
// dBFS, crest < 24.8 dB, and original peak < -5 dBFS. Space/Enter are reserved.
const letters = [3, 7, 11, 14, 20, 25].map(keyName);
const space = keyName(2), enter = keyName(28);
const names = [...letters, space, enter, "click_003.ogg", "click_002.ogg",
  "click_005.ogg", "switch_007.ogg", "drop_001.ogg", "drop_002.ogg"];
const sounds = new Map(names.map(name => {
  const keyboard = name.startsWith("keypress");
  let samples = decode(resolve(DIR, "assets/sfx", name), keyboard
    ? ["highpass=f=140", "highshelf=f=2200:g=-3", "lowpass=f=3800"]
    : ["highpass=f=140", "lowpass=f=6500"]);
  const p = peak(samples);
  let first = samples.findIndex(s => Math.abs(s) > p * (keyboard ? .06 : .02));
  first = Math.max(0, first - Math.round(RATE * .0007));
  const seconds = keyboard ? .085 : name.startsWith("drop") ? .18 : .075;
  samples = samples.slice(first, first + Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    // Round off narrow recording spikes, then preserve the keyboard body.
    if (keyboard) samples[i] = Math.tanh(2 * samples[i] / p);
    const attack = keyboard ? .0015 : .0005, release = keyboard ? .022 : .012;
    samples[i] *= Math.min(1, i / (RATE * attack), (samples.length - 1 - i) / (RATE * release));
  }
  return [name, samples];
}));

// Original, seeded, filtered breath. No source recording or extra asset.
const whooshRng = random(0x57534834);
let low = 0, high = 0;
const whoosh = Float32Array.from({ length: RATE * .2 }, (_, i) => {
  const t = i / (RATE * .2), white = whooshRng() * 2 - 1;
  const cutoff = 1700 - 1100 * t, alpha = 1 - Math.exp(-2 * Math.PI * cutoff / RATE);
  low += alpha * (white - low); high += .035 * (low - high);
  return (low - high) * Math.sin(Math.PI * t) ** 2;
});
sounds.set("original-filtered-whoosh", whoosh);
const mix = new Float32Array(DURATION * RATE * 2), cues = [];
function place(name, type, time, target, peakDb, pitch = 1, variationDb = 0) {
  const original = sounds.get(name), n = Math.floor((original.length - 1) / pitch);
  const samples = Float32Array.from({ length: n }, (_, i) => {
    const at = i * pitch, k = Math.floor(at), f = at - k;
    return original[k] * (1 - f) + original[k + 1] * f;
  });
  const gain = amp(peakDb) / peak(samples), start = Math.round(time * RATE);
  for (let i = 0; i < samples.length && start + i < DURATION * RATE; i++) {
    mix[2 * (start + i)] += samples[i] * gain;
    mix[2 * (start + i) + 1] += samples[i] * gain;
  }
  cues.push({ time, file: name, type, target, peakDb, measuredIsolatedPeakDb: db(peak(samples) * gain), pitch, variationDb,
    duration: samples.length / RATE, sourceTrimmed: true });
}
let previousKey;
for (const action of log.actions) {
  const time = action.time + log.offset, target = action.target || action.key;
  if (action.type === "key") {
    const pool = action.key === " " ? [space] : action.key === "Enter" ? [enter] : letters.filter(n => n !== previousKey);
    const name = pool[Math.floor(rng() * pool.length)]; previousKey = name;
    const variation = rng() * 4 - 2, pitch = .97 + rng() * .06;
    const base = action.key === "Enter" ? -14.5 : action.key === " " ? -17 : -19;
    place(name, action.key === "Enter" ? "enter" : action.key === " " ? "space" : "typing", time, target, base + variation, pitch, variation);
  } else if (action.type === "click") {
    const mode = target === "Bullets", source = target === "Answer source 1", toolbar = target === "Extension toolbar icon";
    place(mode ? "switch_007.ogg" : source ? "click_005.ogg" : toolbar ? "click_003.ogg" : "click_002.ogg",
      mode ? "mode" : source ? "source" : toolbar ? "toolbar" : "click", time, target, toolbar ? -6.5 : -8);
  } else if (action.type === "mousedown") {
    place("click_002.ogg", "selection", time, target, -11);
  } else if (action.type === "accent") {
    const panel = target === "Panel opens";
    place(panel ? "drop_001.ogg" : "drop_002.ogg", panel ? "panel" : "card", time + .035, target, -10.5);
    place("original-filtered-whoosh", "whoosh", time, target, -27);
  }
}
const p = peak(mix);
if (p > amp(-2)) throw new Error(`SFX peak exceeds safety margin: ${db(p)}`);
await wav(resolve(OUT, "sfx.wav"), mix);
await writeFile(resolve(OUT, "sfx-cues.json"), JSON.stringify(cues, null, 2) + "\n");
console.log(`${cues.length} cues, ${db(p).toFixed(2)} dBFS peak; seeded gain/pitch variation, no immediate key repeats`);
