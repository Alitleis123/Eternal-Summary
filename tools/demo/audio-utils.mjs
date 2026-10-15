import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

export const RATE = 48000;
export const DURATION = 26.4;
export const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
export const db = value => 20 * Math.log10(Math.max(1e-12, value));
export const amp = value => 10 ** (value / 20);
export const peak = samples => samples.reduce((p, s) => Math.max(p, Math.abs(s)), 0);
export function run(args, options = {}) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-threads", "2", "-filter_threads", "2", "-filter_complex_threads", "2", ...args], {
    maxBuffer: 100 * 1024 * 1024, windowsHide: true, ...options,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr?.toString() || `FFmpeg exited ${r.status}`);
  return r;
}
export function decode(file, filters = [], channels = 1, extra = []) {
  const r = run(["-v", "error", ...extra, "-i", file,
    ...(filters.length ? ["-af", filters.join(",")] : []),
    "-ar", String(RATE), "-ac", String(channels), "-f", "f32le", "pipe:1"]);
  return Float32Array.from({ length: r.stdout.length / 4 }, (_, i) => r.stdout.readFloatLE(i * 4));
}
export async function wav(file, samples, channels = 2) {
  const b = Buffer.alloc(44 + samples.length * 4);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * channels * 4, 28);
  b.writeUInt16LE(channels * 4, 32); b.writeUInt16LE(32, 34);
  b.write("data", 36); b.writeUInt32LE(samples.length * 4, 40);
  samples.forEach((s, i) => b.writeFloatLE(s, 44 + i * 4));
  await writeFile(file, b);
}
export function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
export function measure(file) {
  const text = run(["-i", file, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]).stderr.toString();
  return JSON.parse(text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1));
}
