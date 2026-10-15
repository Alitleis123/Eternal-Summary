// Audio-only delivery. Never re-encode the approved H.264 stream or poster.
// node tools/demo/build.mjs
// node tools/demo/mix.mjs [approved-video.mp4] [review-directory]
// Requires FFMPEG_PATH / FFPROBE_PATH or both tools on PATH.
// BRAG_ASSETS may override ~/.codex/skills/brag/assets. MP3s stay outside Git.
import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { RATE, DURATION, amp, db, peak, run, decode, wav, measure, ffprobe } from "./audio-utils.mjs";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(DIR, "../.."), generated = resolve(DIR, "generated");
const input = resolve(process.argv[2] || join(root, "docs/demo.mp4"));
const out = resolve(process.argv[3] || join(tmpdir(), "es-demo-review-4"));
const assets = process.env.BRAG_ASSETS || join(homedir(), ".codex/skills/brag/assets");
await mkdir(out, { recursive: true });
const inputHash = videoHash(input);
const cues = JSON.parse(await readFile(join(generated, "sfx-cues.json"), "utf8"));
const clickCues = cues.filter(c => ["toolbar", "mode", "source", "click"].includes(c.type));
const sfx = decode(join(generated, "sfx.wav"), [], 2);
await copyFile(join(generated, "sfx.wav"), join(out, "sfx-stem.wav"));
const summary = { videoStreamSha256Before: inputHash, targetLufs: -16,
  safetyLimiter: { ceilingDb: -2.2, oversampleHz: 192000, attackMs: 5, releaseMs: 80 },
  ducking: { depthDb: 5, clickDepthDb: 3, shape: "cosine, in dB", ranges: [[13.55, 13.9, 21.7, 22.4], [30.5, 31.3, 34.6, 35.45]] },
  stems: { sfx: measure(join(out, "sfx-stem.wav")) }, variants: [] };
summary.stems.sfx.meters = await meters(join(out, "sfx-stem.wav"), "sfx-stem");

async function meters(file, id) {
  const logs = {};
  for (const [name, filter] of [["volume", "volumedetect"], ["ebur128", "ebur128=peak=true"]]) {
    logs[name] = run(["-i", file, "-vn", "-af", filter, "-f", "null", "-"]).stderr.toString();
    await writeFile(join(out, `${name}-${id}.txt`), logs[name]);
  }
  const end = logs.ebur128.slice(logs.ebur128.lastIndexOf("Summary:"));
  return { integratedLufs: Number(end.match(/I:\s*([-.\d]+)/)[1]),
    truePeakDb: Number(end.match(/Peak:\s*([-.\d]+)/)[1]),
    meanVolumeDb: Number(logs.volume.match(/mean_volume:\s*([-.\d]+)/)[1]),
    maxVolumeDb: Number(logs.volume.match(/max_volume:\s*([-.\d]+)/)[1]) };
}

function videoHash(file) {
  return run(["-v", "error", "-i", file, "-map", "0:v:0", "-c:v", "copy", "-f", "hash", "-hash", "sha256", "-"]).stdout.toString().trim().split("=")[1];
}
function inspect(file) {
  const r = spawnSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return JSON.parse(r.stdout);
}
const smooth = t => .5 - .5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
function duck(t) {
  let depth = 0;
  for (const [start, hold, release, end] of summary.ducking.ranges) {
    const amount = t < hold ? smooth((t - start) / (hold - start)) : 1 - smooth((t - release) / (end - release));
    depth = Math.max(depth, amount * 5);
  }
  // A short carve lets the UI click lead the synchronized musical beat.
  for (const c of clickCues) {
    const amount = t < c.time - .01 ? smooth((t - c.time + .04) / .03)
      : 1 - smooth((t - c.time - .055) / .145);
    depth = Math.max(depth, amount * 3);
  }
  return amp(-depth);
}

// Both excerpts start with the hook at frame 0. A documented strong beat
// lands on the fixed 3.2 second toolbar click. No picture timing changes.
for (const variant of [
  { id: "A", volume: 12, strongCue: 8.7423, start: 5.5423 },
  { id: "B", volume: 11, strongCue: 8.9629, start: 5.7629 },
  { id: "C", volume: null },
]) {
  let music = new Float32Array(sfx.length), musicGain = 0;
  const stemName = variant.volume ? `vol-${variant.volume}` : "sfx-only";
  if (variant.volume) {
    const stem = `happy-beats-business-moves-vol-${variant.volume}-by-ende-dot-app`;
    const preset = JSON.parse(await readFile(join(assets, "music/cues", `${stem}.music-cues.json`), "utf8"));
    if (!preset.strongCues.some(c => Math.abs(c.time - variant.strongCue) < .0001)) throw new Error("Music sync cue missing from preset");
    const source = join(assets, "music", `${stem}.mp3`);
    music = decode(source, ["atrim=duration=40", "asetpts=PTS-STARTPTS", "highpass=f=65", "highshelf=f=2800:g=-3", "lowpass=f=11000",
      "acompressor=threshold=0.1:ratio=3:attack=0.1:release=100:knee=2:detection=peak:link=maximum"], 2, ["-ss", String(variant.start)]);
    for (let i = 0; i < music.length; i += 2) {
      const t = i / 2 / RATE;
      const envelope = duck(t) * smooth(t / .08) * (1 - smooth((t - 36.6) / 3.4));
      music[i] *= envelope; music[i + 1] *= envelope;
    }
    await wav(join(out, `music-${variant.id}-raw.wav`), music);
    const raw = measure(join(out, `music-${variant.id}-raw.wav`));
    musicGain = -16.1 - Number(raw.input_i);
    // Adjust only music. A, B and C share the identical SFX at identical gain.
    for (let attempt = 0; attempt < 3; attempt++) {
      const temp = Float32Array.from(sfx, (v, i) => v + (music[i] || 0) * amp(musicGain));
      await wav(join(out, "measure-mix.wav"), temp);
      const integrated = Number(measure(join(out, "measure-mix.wav")).input_i);
      if (Math.abs(integrated + 16) < .04) break;
      musicGain += -16 - integrated;
    }
    music = Float32Array.from({ length: sfx.length }, (_, i) => (music[i] || 0) * amp(musicGain));
    const musicPath = join(out, `music-${variant.id}-stem.wav`);
    await wav(musicPath, music);
    summary.stems[`music${variant.id}`] = measure(musicPath);
    summary.stems[`music${variant.id}`].meters = await meters(musicPath, `music-${variant.id}-stem`);
    variant.music = { source, title: `Happy Beats / Business Moves vol. ${variant.volume}`, sourceStart: variant.start,
      sourceEnd: variant.start + 40, strongCue: variant.strongCue, toolbarTime: 3.2, gainDb: musicGain };
  }
  const premaster = Float32Array.from(sfx, (v, i) => v + music[i]);
  const prePath = join(out, `mix-${variant.id}-premaster.wav`), master = join(out, `mix-${variant.id}.wav`);
  await wav(prePath, premaster);
  const preMeasure = measure(prePath);
  // Safety only, with automatic makeup disabled. Reserve 0.7 dB for AAC.
  run(["-v", "error", "-y", "-i", prePath, "-af", `aresample=192000,alimiter=limit=${amp(-2.2)}:level=false:attack=5:release=80:latency=1,aresample=48000`, "-c:a", "pcm_f32le", master]);
  // The oversampled peak is below the ceiling, so gain reduction is zero.
  // Refuse a mix needing mastering compression instead of hiding it.
  if (Number(preMeasure.input_tp) >= -2.2) throw new Error(`Variant ${variant.id} needs more headroom before the safety limiter`);
  variant.limiterMaxReductionDb = 0;
  variant.preLimiterTruePeakDb = Number(preMeasure.input_tp);
  const output = join(out, `demo-${variant.id}-${stemName}.mp4`);
  run(["-v", "error", "-y", "-i", input, "-i", master, "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", String(RATE), "-t", String(DURATION), "-movflags", "+faststart", output]);
  const hash = videoHash(output);
  if (hash !== inputHash) throw new Error(`Video stream changed in variant ${variant.id}`);
  if ((await stat(output)).size > 12_000_000) throw new Error("Delivery exceeds 12 MB");
  variant.path = output; variant.videoStreamSha256 = hash;
  variant.loudness = measure(output);
  if (Number(variant.loudness.input_tp) > -1.5) throw new Error("AAC true peak exceeds -1.5 dBTP");
  const probe = inspect(output);
  await writeFile(join(out, `ffprobe-${variant.id}.json`), JSON.stringify(probe, null, 2) + "\n");
  variant.meters = await meters(output, variant.id);
  // Inspect ISO BMFF atom order rather than relying on the command line flag.
  const bytes = await readFile(output), atoms = [];
  for (let at = 0; at + 8 < bytes.length;) {
    const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
    atoms.push({ type, offset: at, size }); if (size < 8) break; at += size;
  }
  if (atoms.find(a => a.type === "moov").offset > atoms.find(a => a.type === "mdat").offset) throw new Error("moov follows mdat");
  variant.size = bytes.length; variant.atoms = atoms;
  summary.variants.push(variant);
  console.log(`${variant.id}: ${variant.loudness.input_i} LUFS, ${variant.loudness.input_tp} dBTP, ${bytes.length} bytes, video ${hash}`);
}

// Per-cue measured peaks include any overlapping tail from adjacent cues.
const perCue = cues.map(c => ({ ...c, measuredStemPeakDb: db(peak(sfx.subarray(
  Math.round(c.time * RATE) * 2, Math.round((c.time + c.duration) * RATE) * 2))) }));
const types = {}, overlappedTypes = {};
for (const cue of perCue) {
  types[cue.type] = Math.max(types[cue.type] ?? -Infinity, cue.measuredIsolatedPeakDb);
  overlappedTypes[cue.type] = Math.max(overlappedTypes[cue.type] ?? -Infinity, cue.measuredStemPeakDb);
}
await writeFile(join(out, "cue-list.json"), JSON.stringify(cues, null, 2) + "\n");
await writeFile(join(out, "cue-list.csv"), "time,type,file,target,pitch,gainVariationDb,isolatedPeakDb,measuredStemPeakDb\n" + perCue.map(c =>
  [c.time, c.type, c.file, JSON.stringify(c.target), c.pitch, c.variationDb, c.peakDb, c.measuredStemPeakDb].join(",")).join("\n") + "\n");
await writeFile(join(out, "per-cue-peaks.json"), JSON.stringify({ isolatedTypes: types, overlappedWindows: overlappedTypes, cues: perCue }, null, 2) + "\n");
summary.perCueTypePeaksDb = types;
const keys = cues.filter(c => ["typing", "space", "enter"].includes(c.type));
const log = JSON.parse(await readFile(join(generated, "action-log.json"), "utf8"));
const loggedKeys = log.actions.filter(a => a.type === "key");
if (keys.length !== loggedKeys.length || keys.some((k, i) => Math.abs(k.time - loggedKeys[i].time - log.offset) > 1e-6)) throw new Error("Keystroke timing changed");
if (keys.some((k, i) => i && k.file === keys[i - 1].file)) throw new Error("Repeated adjacent keyboard sample");
summary.keystrokeAudit = { count: keys.length, maxTimingErrorSeconds: 0, immediateRepeats: 0, uniqueSamples: new Set(keys.map(k => k.file)).size };
summary.noMusicNote = "C retains the same SFX gain as A and B. Its lower integrated loudness is intentional; normalizing sparse UI effects to -16 would crush or amplify clicks and defeat the comparison.";

// Standalone scientific images and passage audio for review, outside Git.
const a = summary.variants[0].path;
for (const [name, inputPath, extra] of [
  ["A-full-mix", a, []], ["typing-only", join(out, "sfx-stem.wav"), ["-ss", "13.75", "-t", "3.85"]],
]) {
  run(["-v", "error", "-y", ...extra, "-i", inputPath, "-filter_complex", "[0:a]showwavespic=s=1600x400:split_channels=1:colors=0x167d8d|0x507050[v]", "-map", "[v]", "-frames:v", "1", "-update", "1", join(out, `${name}-waveform.png`)]);
  run(["-v", "error", "-y", ...extra, "-i", inputPath, "-filter_complex", "[0:a]showspectrumpic=s=1600x600:legend=1:scale=log:fscale=log:color=viridis[v]", "-map", "[v]", "-frames:v", "1", "-update", "1", join(out, `${name}-spectrogram.png`)]);
}
run(["-v", "error", "-y", "-ss", "13.75", "-t", "3.85", "-i", join(out, "sfx-stem.wav"), "-c:a", "pcm_s24le", join(out, "typing-only.wav")]);
await writeFile(join(out, "audio-report.json"), JSON.stringify(summary, null, 2) + "\n");
// Publish only after every variant, stream hash and loudness check passes.
await copyFile(summary.variants[0].path, join(root, "docs/demo.mp4"));
console.log(`Report and variants: ${out}`);
