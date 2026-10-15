// Publishes the rendered demo locally: `node tools/demo/finish.mjs <raw.mp4>`.
// Requires ffmpeg on PATH, or FFMPEG_PATH pointing to its executable.
// Extracts the poster without changing the dense-article opening frame.
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
  const result = spawnSync(ffmpeg, ["-hide_banner", "-y", "-threads", "2", "-filter_threads", "2", "-filter_complex_threads", "2", ...args], { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status}`);
};
run(["-ss", "2.8", "-i", input, "-frames:v", "1", "-q:v", "2", "-update", "1", poster]);
run([
  "-i", input,
  "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-crf", "20", "-preset", "slow",
  "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", output,
]);
