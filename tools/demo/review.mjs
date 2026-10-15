// Delivery checks and contact sheets. Artifacts stay outside Git.
// node tools/demo/review.mjs [review-directory]
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { run, ffprobe } from "./audio-utils.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = resolve(process.argv[2] || join(tmpdir(), "es-demo-review-6"));
await mkdir(out, { recursive: true });
const video = resolve(root, "docs/demo.mp4");
const probe = spawnSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", video], { windowsHide: true });
if (probe.status !== 0) throw new Error(probe.stderr.toString());
const metadata = JSON.parse(probe.stdout);
const v = metadata.streams.find(s => s.codec_type === "video");
const a = metadata.streams.find(s => s.codec_type === "audio");
if (v.codec_name !== "h264" || v.pix_fmt !== "yuv420p" || v.width !== 1920 || v.height !== 1080 || v.r_frame_rate !== "30/1" || Number(v.nb_frames) !== 792) throw new Error("Unexpected delivery video format");
if (a.codec_name !== "aac" || Math.abs(Number(metadata.format.duration) - 26.4) > .02 || (await stat(video)).size >= 12_000_000) throw new Error("Unexpected delivery audio, duration or size");
const bytes = await readFile(video), atoms = [];
for (let at = 0; at + 8 < bytes.length;) {
  const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
  atoms.push(type); if (size < 8) break; at += size;
}
if (atoms.indexOf("moov") > atoms.indexOf("mdat")) throw new Error("Delivery is missing faststart");
const frames = JSON.parse(await readFile(resolve(root, "tools/demo/generated/frame-audit.json"), "utf8"));
const chars = Math.max(...frames.filter(f => f.time < 5.5).map(f => f.panelChars[0] || 0));
const first = frames.find(f => f.panelChars[0] > 0), settled = frames.find(f => f.panelChars[0] === chars);
// The toolbar click lands at 1.95 s, slow enough to follow.
if (!settled || settled.time > 3.6) throw new Error("Summary settles after 3.6 seconds");
const report = { metadata, atoms, firstSummaryTextSeconds: first.time, settledSummarySeconds: settled.time, summaryCharacters: chars };
await writeFile(join(out, "delivery-report.json"), JSON.stringify(report, null, 2) + "\n");

for (const [name, width] of [["phone", 390], ["full", 1920]]) {
  const fontSize = name === "phone" ? 14 : 44;
  run(["-v", "error", "-y", "-i", video, "-vf",
    `select='not(mod(n,45))',setpts=N*1.5/TB,scale=${width}:-1:flags=lanczos,drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='%{pts\\:hms}':fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.8:x=4:y=h-th-4,tile=3x6:nb_frames=18:padding=8:margin=8:color=0x100f14`,
    "-frames:v", "1", "-threads", "2", "-q:v", "2", "-update", "1", join(out, `contact-${name}.jpg`)]);
}
for (const [name, time] of [["toolbar", 1.7], ["summary", 4.6], ["question", 7.3], ["answer", 10.5], ["source", 14.3], ["offer", 18.6], ["selection", 21.2]]) {
  run(["-v", "error", "-y", "-ss", String(time), "-i", video, "-vf", "scale=390:-1:flags=lanczos", "-frames:v", "1", "-threads", "2", "-q:v", "2", "-update", "1", join(out, `phone-${name}.jpg`)]);
}
console.log(`26.4 seconds, 792 frames, ${bytes.length} bytes; summary settled at ${settled.time}s; contact sheets in ${out}`);
