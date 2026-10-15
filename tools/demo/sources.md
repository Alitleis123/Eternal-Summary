# Demo sources

This is a 40 second recording of the extension in use, with a short hook and
outro. The source is the real `tools/demo-article.html` served by
`test/driver.js`, with the actual background, listener, panel, selection
button, selection card, text reveals and source highlighting. Only the model
replies are fixed. `record.mjs` reads the existing `REPLIES` literal from
`tools/shots.mjs`, so the video and screenshots use identical reply copy.
It keeps the product's text animation enabled.

## Regeneration

The commands are at the top of `index.html`. Use Node 22 or later, FFmpeg and
FFprobe on PATH, plus Chrome Headless Shell from Hyperframes 0.8.159.
`CHROME_PATH` points at the headless shell. `FFMPEG_PATH` may override the
FFmpeg executable for the record, build and finish scripts.

1. `record.mjs` starts a local fixture server on a free port and a separate
   headless browser profile. It uses CDP input for clicks and typing. The
   paragraph selection extends a native selection range over 48 frames.
2. It pauses virtual time, advances two steps of 1/60 second, then captures
   each 30 fps frame with `HeadlessExperimental.beginFrame`. This preserves
   the extension's normal 60 Hz text reveal speed. There is no real-time
   screen recorder or skipped wall-clock deadline.
3. Chrome launches with `--window-size=1120,630` and
   `--force-device-scale-factor=1.5`. There is no CDP device-scale override.
   The CSS layout remains 1120x630, and beginFrame returns real 1680x945
   device pixels. The recorder checks every bitmap's dimensions. The panel
   still occupies 38% of the recorded width. The intermediate uses H.264
   yuv444p because its 945-pixel height is odd. Delivery is 1920x1080 yuv420p.
4. The recording goes straight to FFmpeg through an image pipe. No frame
   directory is needed for the render. `generated/` contains `usage.mp4`,
   sample captures, `action-log.json` and `frame-audit.json`. These are ignored
   by Git. The action log has times and coordinates for clicks, typed
   characters, Enter, scroll gestures and each selection extension.
5. `build.mjs` writes the cursor schedule and a deterministic stereo SFX WAV
   from that log. The audio section below describes sample selection,
   filtering, pitch variation and exact cue gains. All 49 keystrokes retain
   their recorded timing. `generated/sfx-cues.json` lists every sound.
6. Hyperframes renders the footage, small step labels, toolbar icon, cursor,
   click rings and outro. Two localized camera moves enlarge whole UI text
   blocks over the original footage. Each uses the same source media time
   and a cursor inside the same transformed wrapper. Crops end in UI padding.
   The answer view grows to 1.25x from 17 to 17.8 seconds, holds until 21.7,
   then returns by 22.4. The selection card grows to 1.3x from 30.5 to 31.3,
   holds until 34.6, then returns by 35.45. Both use `sine.inOut` easing.
   Media playback belongs to Hyperframes. One paused GSAP timeline controls
   the overlays.
7. `finish.mjs` extracts the settled summary at 6.4 seconds as the poster,
   replaces only frame 0, and writes H.264 yuv420p at CRF 22 with AAC and
   faststart to `docs/demo.mp4`. It writes `docs/shots/demo-poster.jpg` too.
8. `mix.mjs` builds the final music and SFX stems, then remuxes the approved
   video with `-c:v copy`, AAC at 256 kbps and faststart. It verifies stream
   hashes, loudness, true peak, size, atom order and keystroke timing before
   replacing `docs/demo.mp4` with A. It does not touch the poster. B, C,
   stems, meter logs, cue reports and signal plots stay outside Git.

The record and review browser profiles, servers and encoders are disposable.
The scripts close their own processes in cleanup. They do not use the shared
desktop, signed-in browser profiles or a model API.

## Timeline

| Time | Caption | Product action |
| --- | --- | --- |
| 0 to 1.6 | Read the page, not all of it. | Article before opening the extension |
| 1.6 to 8.6 | Summarize the page | Scroll, toolbar click at 3.2, summary reveal and verdict |
| 8.6 to 13.6 | Switch to bullets | Click Bullets and reveal the list |
| 13.6 to 22.9 | Ask a follow-up | Focus input, type, Enter at 17.3, reveal answer |
| 22.9 to 26 | Jump to the source | Click source 1, article scrolls and highlights the passage |
| 26 to 36.6 | Summarize a highlight | Close, scroll, drag selection, Summarize at 30.1, reveal card |
| 36.6 to 40 | Eternal Summary. Add to Chrome | Outro |

## Audio

No voice. A is the recommended music and SFX mix in `docs/demo.mp4`.
B uses the same SFX with another track. C has those same SFX at the same
gain with no music. The MP3s and review variants are not committed.

### Music sources and timing

Music by Sascha Ende at [ende.app](https://ende.app/en), under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The
[ende.app standard license](https://ende.app/en/standard-license) also
makes attribution optional. Credits are retained here.

- A uses "Happy Beats / Business Moves vol. 12". Its steadier pulse suits
  reading better than the more energetic bundled tracks. Exact source:
  `C:\Users\alitl\.codex\skills\brag\assets\music\happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`.
  The excerpt starts at source time 5.5423 seconds. The preset's strong beat
  at 8.7423 lands on the toolbar click at video time 3.2 seconds.
- B uses "Happy Beats / Business Moves vol. 11" for a warmer, more rhythmic
  comparison. Exact source:
  `C:\Users\alitl\.codex\skills\brag\assets\music\happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`.
  The excerpt starts at 5.7629 seconds. Its strong cue at 8.9629 also lands
  on the toolbar click at 3.2 seconds.

The cue JSONs are beside those MP3s in `music/cues/`, named
`<track-stem>.music-cues.json`. Their Markdown summaries and the brag
skill's `references/audio.md` informed the selection. The script checks
that both selected cues exist in those presets. Both tracks start with
the opening hook at time 0, with an 80 ms entrance to avoid a cut click.
The outro fades the music from 36.6 to 40 seconds.

Music has a 65 Hz high-pass, a 3 dB high shelf cut above 2.8 kHz and an
11 kHz low-pass. A music-only peak compressor controls the drums with
threshold 0.1, ratio 3, attack 0.1 ms, release 100 ms and no makeup gain.
After gain matching, the music peaks below the toolbar click. A cosine
envelope ducks it by 5 dB over the typing and first punch-in, with ramps
at 13.55 to 13.9 and 21.7 to 22.4 seconds. The second punch-in has ramps
at 30.5 to 31.3 and 34.6 to 35.45. Brief 3 dB dips around UI clicks let
their transients lead. The script adjusts only the music gain to target
about -16 LUFS for each music mix. SFX levels are identical in A, B and C.

### Keyboard and UI sources

`audit-keyboard.mjs` measures all 32 bundled files from
[Keyboard Soundpack #1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes)
by unicae_games, CC0. The page identifies the recorded keyboard as a
Cherry KC 1000. The processing aims for a quiet laptop keyboard.

The objective audit records peak, RMS, duration, active duration, noise
floor, spectral centroid and energy above 5 kHz. The centroid uses a
2048-point Hann FFT with power weighting. Noise floor is the 10th
percentile of 5 ms RMS windows, including each recording's quiet tail.
Accepted files have centroid below 2850 Hz, noise floor below -61 dBFS,
crest below 24.8 dB and original peak below -5 dBFS. Eight pass. All 32
measurements, rejection reasons and an ordered audition reel are saved
in the review directory. This was an objective, headless audition.

Letters use `keypress-003.wav`, `007`, `011`, `014`, `020` and `025`.
Space reserves `keypress-002.wav`; Enter reserves `keypress-028.wav`.
These small original CC0 files are committed in `assets/sfx/`. A seeded
generator assigns each recorded keystroke a sample with no immediate
repeats, gain variation of up to 2 dB either way and pitch variation of
up to 3 percent. There are 49 keystrokes and zero timing error relative
to the action log. No streaming text receives a sound.

Keys have a 140 Hz high-pass, 3 dB high shelf cut above 2.2 kHz and a
3.8 kHz low-pass. A soft saturation curve rounds narrow spikes. The
script trims recorded pre-roll, retains up to 85 ms of body, and applies
a 1.5 ms attack and 22 ms tail fade. Letters peak at a base -19 dBFS,
Space at -17 and Enter at -14.5, before per-hit variation.

The other committed samples are from
[Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds), CC0:

- Toolbar uses `click_003.ogg`, with an isolated peak of -5.50 dBFS.
- Mode uses `switch_007.ogg`; source uses `click_005.ogg`. Both peak at -8.
- Input, close and selection-summary clicks use `click_002.ogg` at -8.
  The selection drag's mouse-down uses it at -11.
- Panel opening uses `drop_001.ogg`; selection card uses `drop_002.ogg`.
  Both start 35 ms after the click and peak at -10.5.
- Each opening also has an original 200 ms filtered-noise whoosh at -27.
  `build.mjs` synthesizes it from seeded noise with a falling cutoff and
  a sine-squared envelope. There is no third-party whoosh recording.

The previous impact thud and casino slide are unused. There are 60 cues
including 49 keys and two quiet whoosh layers. Maximum isolated processed
peaks by type are -17.17 for letters, -15.22 for Space and -14.37 for Enter.
The full SFX stem peaks at -5.50 dBFS. `per-cue-peaks.json` distinguishes
isolated cue peaks from windows that also contain overlapping cue tails.

### Rebuild and delivery measurements

With FFmpeg and FFprobe on PATH or their `FFMPEG_PATH` and `FFPROBE_PATH`
overrides set, run these from the repository root:

```powershell
node tools/demo/audit-keyboard.mjs C:\Users\alitl\.codex\skills\brag\assets C:\Users\alitl\AppData\Local\Temp\es-demo-review-4
node tools/demo/build.mjs
node tools/demo/mix.mjs
```

`BRAG_ASSETS` can override the external music and cue-preset directory.
`mix.mjs` accepts an approved video path and a review directory as optional
arguments. The default approved video is `docs/demo.mp4`; the default review
directory is `%TEMP%\es-demo-review-4`. It stages all outputs before replacing
A. A second build produced identical SHA256 file hashes for A, B and C.

The final safety limiter uses 192 kHz oversampling, a -2.2 dBFS ceiling,
5 ms attack, 80 ms release and disabled automatic makeup. Its gain reduction
is 0.00 dB for all three variants. Premaster true peaks are -2.66, -4.32 and
-5.38 dBTP, each below the limiter ceiling. AAC remains below -1.5 dBTP.

Actual `ebur128=peak=true` and `volumedetect` output after AAC encoding:

| Mix | Integrated LUFS | True peak dBTP | Mean dBFS | Maximum dBFS | Bytes |
| --- | --- | --- | --- | --- | --- |
| A, vol. 12 | -15.9 | -2.7 | -18.2 | -2.7 | 5201376 |
| B, vol. 11 | -15.9 | -4.4 | -18.1 | -4.5 | 5196583 |
| C, SFX only | -28.4 | -5.4 | -40.7 | -5.5 | 4020772 |

The PCM music stems measure -15.9 LUFS each, with true peaks of -6.3 for
A and -6.4 for B. The SFX stem measures -28.4 LUFS and -5.4 dBTP. The
`loudnorm` analysis independently reads full mixes at -16.04, -16.03 and
-28.42 LUFS. Both meters' actual results are retained in the report.
C intentionally stays quieter. Raising sparse effects to -16 LUFS would
change the SFX comparison and require heavy peak compression.

All variants are 40 seconds, H.264 yuv420p, 1920x1080, 30 fps and 1200 frames.
AAC is encoded at 256 kbps, 48 kHz stereo. FFprobe reports 262123 bps for A
and 261164 for B. C's long silences reduce its actual AAC rate to 26128 bps.
All have `moov` before `mdat` and remain below 12 MB.

The approved round 3 video stream SHA256, and the matching stream SHA256 in
A, B and C, is
`5c77271565fb13aed2cfe184ca864df4c0ac5435dae3bafab448eb0a04c56393`.
Frame 0 and the poster are unchanged. The review directory contains raw
FFprobe, `volumedetect` and `ebur128` output for each variant, stem meters,
cue lists, per-cue peaks, the full-mix waveform and spectrogram, and the
typing-only waveform and spectrogram. `audio-report.json` records the mix
settings and verification results.

## Included dependencies

- Newsreader variable font from Google Fonts `ofl/newsreader`. Its SIL Open
  Font License is included in `assets/newsreader-OFL.txt`.
- GSAP 3.15.0 from npm. Its copyright notice and standard license link remain
  in `assets/gsap.min.js`.
- The extension's own 32 and 128 pixel icons, copied from `icons/`.
- Hyperframes 0.8.159. No browser, FFmpeg binary, installed package, raw
  footage or render cache is committed.
