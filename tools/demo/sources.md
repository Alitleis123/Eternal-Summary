# Demo sources

The demo is 28 seconds. It opens on the dense article and starts revealing
its summary at 0.233 seconds. All 552 summary characters are visible at
1.533 seconds. The question, answer and source sequence occupies 12.6 seconds,
the longest part of the cut. The Bullets detour has been removed.

The source is the real `tools/demo-article.html` served by `test/driver.js`.
The actual extension handles the panel, text reveals, selection button,
selection card and source highlight. Only the model replies are fixed.
`record.mjs` reads the existing `REPLIES` literal in `tools/shots.mjs`.
The shorter question is "What kept it running?". No product copy or product
styles are replaced for the recording.

## Regeneration

Use Node 22 or later, the installed Hyperframes 0.8.159, FFmpeg, FFprobe and
Chrome Headless Shell with beginFrame support. Set `CHROME_PATH` to the
headless shell. `FFMPEG_PATH` and `FFPROBE_PATH` override the executables.
Hyperframes also needs FFmpeg and FFprobe on PATH. `BRAG_ASSETS` can override
`C:\Users\alitl\.codex\skills\brag\assets` for the external music and cue
preset. There are no model calls, signed-in profiles or visible windows.

Run from the repository root. The same commands appear in `index.html`.

```powershell
node tools/demo/record.mjs
node tools/demo/build.mjs
npx hyperframes@0.8.159 check tools/demo
npx hyperframes@0.8.159 render tools/demo --fps 30 --quality delivery --workers 2 --output brag-output/demo-raw.mp4
node tools/demo/finish.mjs brag-output/demo-raw.mp4
node tools/demo/mix.mjs
node tools/demo/review.mjs
npm test
npm run check
```

The scripts limit their FFmpeg encoders and filter pools to two threads.
The review render used two Hyperframes workers under a two-CPU process
affinity limit. Raw media, profiles, action logs, stems and caches stay
outside Git. Review artifacts default to `%TEMP%\es-demo-review-5`.
`DEMO_REVIEW_DIR` overrides the recorder's review directory. `mix.mjs` accepts
an approved video path and a review directory as optional arguments.
`review.mjs` accepts a review directory as its optional argument.

1. `record.mjs` starts a disposable local fixture server and isolated browser
   profile. Chrome launches with `--window-size=1120,630` and
   `--force-device-scale-factor=3`. The CSS layout stays 1120 by 630, while
   beginFrame returns 3360 by 1890 device pixels. Every bitmap is checked.
2. The recorder pauses virtual time, advances two steps of 1/60 second,
   and captures each 30 fps frame with `HeadlessExperimental.beginFrame`.
   This preserves the product's normal text reveal speed. The 24.6 second
   recording has 738 frames and no browser console errors. The compressed
   source is 15,588,531 bytes.
3. JPEG frames go directly to an FFmpeg image pipe. No frame directory is
   needed. The H.264 yuv444p intermediate retains chroma detail at CRF 15.
   `generated/` holds the footage, a few stills, `action-log.json` and
   `frame-audit.json`. The latter records text length and selection state
   at every frame. Input, scroll and selection use CDP and the native DOM
   selection. The selection grows over 18 frames.
4. `build.mjs` makes the pointer schedule and SFX WAV from the action log.
   All 22 keystrokes, including Enter, use their logged times without an
   offset. There is no sound on streamed answer text.
5. Hyperframes owns media playback. A single paused GSAP timeline controls
   the whole-browser camera, captions, pointer, rings and outro. The old
   duplicate video lenses and small corner step labels are gone.
6. `finish.mjs` extracts the settled summary at 2.8 seconds for
   `docs/shots/demo-poster.jpg`. It preserves the opening article frame and
   encodes `docs/demo.mp4` as H.264 yuv420p at CRF 20 with AAC and faststart.
7. `mix.mjs` builds only A, replaces its audio with AAC at 256 kbps, and
   copies the approved H.264 stream. It checks video hashes, loudness,
   true peak, size, atom order and keystroke timing before replacing the
   delivered file. The poster stays unchanged by this audio step.
8. `review.mjs` checks delivery format and summary timing, then samples
   every 1.5 seconds. `contact-phone.jpg` has 390 pixel wide tiles.
   `contact-full.jpg` keeps 1920 pixel wide tiles. Individual phone frames
   cover summary, question, answer, source and selection. They stay in the
   review directory.

The recorder closes its own server, browser, profile and encoder in cleanup.
It uses no shared desktop or other machine. Free space before capture was
about 98 GiB, and available VM RAM was about 9.4 GiB.

## Timeline and captions

Captions use Newsreader at 76 pixels, with light text on `#100F14`.
They occupy a fixed band above the UI, so they never cover panel text.
Each enters over 0.2 seconds. Even after that entrance, every caption
exceeds 0.3 seconds per word and the 1.5 second minimum.

| Time | Caption | Product action |
| --- | --- | --- |
| 0 to 5 | A long article. A short answer. | Toolbar at 0.2, summary settles at 1.533, result holds |
| 5 to 13.9 | Get answers without leaving the page. | Focus at 5, type at 5.2 to 6.2, Enter at 6.6, reveal answer and hold |
| 13.9 to 17.6 | See exactly where the answer came from. | Widen, source click at 14.5, article scroll, move into highlighted passage at 15.3 |
| 17.6 to 24.6 | Only need one paragraph? Highlight it. | Close, scroll for 0.4, select at 18.3 to 18.9, Summarize at 19.2, reveal and hold |
| 24.6 to 28 | Eternal Summary. Add to Chrome. | Outro, fully visible by 25, holds to the last frame |

## Camera and sharpness

The UI sits inside an 1824 by 828 viewport at output position 48,204.
A rounded clip mask changes the visible window width with the camera.
Panel holds show only the panel, centered horizontally on the dark frame.
The summary window is 1354.5 pixels wide. The input and answer windows are
1397.5 pixels wide. Their edges follow the source panel's borders at CSS
x 690 and 1120. No article is visible beside the panel during these holds.

The selection result uses a centered 1300 pixel wide window aligned to the
card's CSS borders at x 240 and 640. Its top clips 20 pixels below the
viewport top, at the card's top border. Its 36 pixel rounded corners match
the scaled card corners and remove the article behind them. Other windows
keep the existing 12 pixel corner radius, defined by `--window-radius`.

The mask narrows from 0.2 to 1.25 seconds, follows the scale change from
4.5 to 5, and widens again from 13.9 to 14.5 for the source jump. It stays
wide through the highlighted passage and paragraph selection, then narrows
to the card from 19.2 to 19.85. Mask and camera use the same easing and
time windows. Article fragments can pass through while the camera moves;
the panel and card holds contain only their own UI.

One wrapper contains the entire source frame, a 30 pixel browser toolbar,
pointer and click rings. Its transform origin is 0,0. All camera coordinates
below are relative to the fixed viewport, measured in source CSS pixels
before scaling. Source media, text scale, captions, action times and audio
are unchanged by the crop correction.

| Move | Time | Final scale and position |
| --- | --- | --- |
| Article to summary | 0.2 to 1.25 | Scale 3.15, x -1938.75, y -770 |
| Follow-up input | 4.5 to 5 | Scale 3.25, x -2029.25, y -1317 |
| Question and answer | 6.6 to 7.25 | Scale 3.25, x -2029.25, y -960 |
| Article and source | 13.9 to 14.5 | Scale 1.65, x -24, y -180 |
| Highlighted source passage | 15.3 to 15.8 | Scale 2.5, x 62, y -453.5 |
| Paragraph selection | 17.6 to 18.15 | Scale 2.1, x -264, y -160 |
| Selection result | 19.2 to 19.85 | Scale 3.25, x -518, y -951.75 |

The opening wide pose is scale 1.255 at x 209.2, y 0. The first move uses
`power2.inOut`; later moves use `sine.inOut`. The answer pose holds for
6.65 seconds before the source move. The answer text finishes at 7.633
seconds. The selection camera holds for 4.75 seconds; its text finishes
at 20.5 seconds and stays visible for another 4.1 seconds.

At maximum zoom, one CSS pixel occupies 3.25 output pixels, backed by three
source pixels. That is 1.083 times the recorded resolution. The panel spans
about 73 percent of the full output width during the answer, compared with
38 percent in the old cut. Panel body text is about 47 output pixels at
that pose. The 390 pixel phone samples retain captions at about 15 pixels
and panel text at about 9.5 pixels.

## Audio

There is no voice. Only mix A is rebuilt. The optional B and C comparison
cuts are dropped. SFX samples, processing and per-cue gains stay unchanged.
Shorter typing and the removed Bullets click change cue count and timing.

### Music

A uses "Happy Beats / Business Moves vol. 12" by Sascha Ende at
[ende.app](https://ende.app/en), under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The
[standard license](https://ende.app/en/standard-license) also makes
attribution optional. The source remains outside Git at
`C:\Users\alitl\.codex\skills\brag\assets\music\happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`.

The excerpt starts at source time 8.5423 seconds. The strong cue at
8.7423 lands on the new toolbar click at video time 0.2. The script verifies
the cue against the track's JSON in `music/cues/` beside the MP3.

The previous A music stem measured -16.04 LUFS with loudnorm and -15.9 with
ebur128. The new stem targets -22.04 LUFS, six LU lower. The script measures
the filtered, ducked music, then applies one constant gain. It does not
normalize the full mix or target -16 LUFS. SFX get no compensating gain.

Music retains the 65 Hz high-pass, 3 dB shelf cut above 2.8 kHz, 11 kHz
low-pass and peak compressor. The compressor uses threshold 0.1, ratio 3,
attack 0.1 ms, release 100 ms and no makeup gain. The entrance is 80 ms.
The outro fades from 24.6 to 28 seconds. Five dB cosine ducks cover the
question and selection result. Their ramp boundaries are 4.8, 5.2, 13.9,
14.5 and 19.2, 19.85, 23.9, 24.6. UI clicks retain brief 3 dB dips.

### Keyboard and UI effects

The existing audit selected eight CC0 samples from
[Keyboard Soundpack #1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes)
by unicae_games. The page names a Cherry KC 1000. Letters use
`keypress-003.wav`, `007`, `011`, `014`, `020` and `025`. Space uses `002`;
Enter uses `028`. The original small files are in `assets/sfx/`.

A seeded generator picks samples without immediate repeats, with up to
2 dB of gain variation and 3 percent pitch variation. Filtering remains
a 140 Hz high-pass, a 3 dB shelf cut above 2.2 kHz and a 3.8 kHz low-pass.
Soft saturation rounds spikes. The script trims pre-roll, keeps up to
85 ms of body, and applies a 1.5 ms attack and 22 ms tail. Base isolated
peaks remain -19 dBFS for letters, -17 for Space and -14.5 for Enter.

The remaining CC0 samples are from
[Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds).
The toolbar click stays at -5.5 dBFS. The source jump stays at -8.
Input, close and selection-summary clicks stay at -8; selection mouse-down
stays at -11. Panel and card opening effects stay at -10.5, 35 ms after
their clicks, with the original seeded 200 ms noise whoosh at -27.
Summary appearance and the source jump retain the stronger accents.
There are 32 cues, including 22 keys and two quiet whoosh layers.

### Delivery measurements

These are measured input values from FFmpeg analysis, before any analysis
filter's hypothetical normalization. No normalized analysis output is used
as delivery audio.

| Signal | Integrated LUFS, loudnorm | Integrated LUFS, ebur128 | True peak dBTP |
| --- | --- | --- | --- |
| Previous A music stem | -16.04 | -15.9 | -6.33 |
| New A music stem | -22.04 | -22.0 | -11.52 |
| Previous SFX stem | -28.41 | -28.4 | -5.38 |
| New SFX stem | -28.73 | -28.7 | -5.38 |
| Final A after AAC | -21.95 | -21.9 | -3.83 |

The music stem is exactly 6.00 LU lower by loudnorm measurement. The SFX
sample peak stays at -5.50 dBFS and its true peak stays at -5.38 dBTP.
Its integrated level changes by -0.32 LU because the shorter edit contains
fewer keyboard hits and no Bullets click. The original SFX processing,
base gains and random variation ranges are unchanged. No SFX normalization
was applied to force the aggregate meter back to its old value.

The new music's constant gain after filtering and ducking is +2.43 dB.
The premaster measures -3.79 dBTP. The safety limiter keeps its existing
192 kHz oversampling, -2.2 dBFS ceiling, 5 ms attack, 80 ms release and
disabled makeup gain. It applies 0.00 dB gain reduction. The AAC result
stays below the required -1.5 dBTP limit. All 22 keystroke cue timestamps
match the action log exactly, with zero timing error and zero immediate
sample repeats. Eight keyboard samples appear in the new cut.

The delivered file is 5,189,441 bytes, 28.000 seconds, 840 frames,
1920 by 1080, 30 fps, H.264 yuv420p. Audio is AAC, stereo, 48 kHz,
encoded at 256 kbps. `moov` starts at byte 32, before `mdat` at 31784.
The video stream SHA256 is
`8a545227b44f04cd095e3759fb2ead635a500f7c7354f909caa2add272658628`.
It is identical before and after the audio mix.
The AAC stream SHA256 is
`197c44fe9c30b41205e608047ebfbcad77c8a51ee0c14d2c47322076d98343ff`.
It matches the approved audio in commit `2355dfe` exactly.

The final Hyperframes render used screenshot capture with the VM's hardware
GPU and completed in 2 minutes 33.0 seconds. Lint and check pass. The check
has zero runtime, layout and contrast findings. Two non-blocking structural
warnings suggest sub-compositions for the toolbar and outro. The keyframe
diagnostic and camera proof are retained in the review directory. All 70
repo tests pass, along with `npm run check` and syntax checks on the demo
scripts. `git diff --check` passes.

The final contact sheets were viewed. At 390 pixels wide, the captions,
summary, question, answer and selection result are readable. Panel and card
holds contain no article fragments. The source
sequence first shows the page scroll with its source button visible, then
moves into the highlighted passage. The sheets sample frames 0, 45, 90
and every following 45th frame through frame 810, with timestamps.
Their paths are `%TEMP%\es-demo-review-5\contact-phone.jpg` and
`%TEMP%\es-demo-review-5\contact-full.jpg`. Detailed measurements,
FFprobe output, cue peaks, waveforms, spectrograms and execution logs
remain in that directory.

## Included dependencies

- Newsreader variable font from Google Fonts `ofl/newsreader`. The SIL
  Open Font License is in `assets/newsreader-OFL.txt`.
- GSAP 3.15.0. Its copyright notice and standard license link remain
  in `assets/gsap.min.js`.
- The extension's own 32 and 128 pixel icons, copied from `icons/`.
- Hyperframes 0.8.159. No browser, FFmpeg executable, installed package,
  raw footage or render cache is committed.
