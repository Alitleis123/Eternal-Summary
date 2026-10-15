// Publishes the rendered demo locally: `node tools/demo/finish.mjs <raw.mp4>`.
// Requires ffmpeg on PATH, or FFMPEG_PATH pointing to its executable.
// Keeps timing and frame count while baking the strongest settled frame as 0.
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const input = resolve(process.argv[2] || resolve(root, "brag-output/demo-raw.mp4"));
const poster = resolve(root, "docs/shots/demo-poster.jpg");
const output = resolve(root, "docs/demo.mp4");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
await mkdir(resolve(root, "docs/shots"), { recursive: true });
const run = (args) => {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-y", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status}`);
};
run(["-ss", "6.4", "-i", input, "-frames:v", "1", "-q:v", "2", "-update", "1", poster]);
run([
  "-i", input, "-i", poster,
  "-filter_complex", "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]",
  "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-crf", "22", "-preset", "slow",
  "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", output,
]);
