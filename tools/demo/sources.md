# Demo sources

The demo is 26.4 seconds. It opens on the article, then the cursor travels
to the toolbar for a full second, so a viewer sees where the extension
starts. The extension's name appears as a tooltip and the click lands at
1.97 seconds. The summary finishes at 3.3. The question,
answer and source sequence runs from 5.75 to 15.4 seconds, the longest part
of the cut. The Summarize button after a highlight sits on screen for 1.5
seconds before the click.

The source is the real `tools/demo-article.html` served by `test/driver.js`.
The extension handles the panel, page reflow, hover states, text reveals,
selection button, selection card and source highlight. Only the model
replies are fixed. `record.mjs` reads the existing `REPLIES` literal in
`tools/shots.mjs`. Chrome maps the fictional host `meridian.example` to the
local fixture server, so the panel header reads "meridian.example · 2 min
read" instead of "localhost". No product copy or product styles change.

## Regeneration

Use Node 22 or later, Hyperframes 0.8.159, FFmpeg, FFprobe and Chrome
Headless Shell with beginFrame support. Set `CHROME_PATH` to the headless
shell. `FFMPEG_PATH` and `FFPROBE_PATH` override the executables, and
Hyperframes also needs both on PATH. `BRAG_ASSETS` can override
`C:\Users\alitl\.codex\skills\brag\assets` for the external music and cue
preset. Set `DO_NOT_TRACK=1` so the Hyperframes CLI sends no usage
telemetry. There are no model calls, signed-in profiles or visible windows.

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

The scripts limit FFmpeg encoders and filter pools to two threads, and the
render uses two Hyperframes workers. Raw media, profiles, action logs, stems
and caches stay outside Git. Review artifacts default to
`%TEMP%\es-demo-review-6`. `DEMO_REVIEW_DIR` overrides the recorder's review
directory. `mix.mjs` takes an approved video path and a review directory as
optional arguments. `review.mjs` takes a review directory.

1. `record.mjs` starts a disposable fixture server and an isolated browser
   profile. Chrome launches with `--window-size=1120,630`,
   `--force-device-scale-factor=3` and a host resolver rule for
   `meridian.example`. The CSS layout stays 1120 by 630, while beginFrame
   returns 3360 by 1890 device pixels. Every bitmap is checked.
2. The recorder pauses virtual time, advances two steps of 1/60 second, and
   captures each 30 fps frame with `HeadlessExperimental.beginFrame`. This
   keeps the product's text reveal speed. The 22.7 second recording has
   682 frames and no browser console errors.
3. Chrome acknowledges input only when virtual time advances. Awaiting each
   dispatch stalled for about 10 seconds and once dropped the Summarize
   click, so the recorder sends input without waiting and Chrome handles it
   in the next captured frame. Failed dispatches are collected and fail the
   recording.
4. Cursor moves are logged with their start, end and duration. Moves over
   the page also go to Chrome frame by frame on the same `power2.inOut`
   curve the composition draws, so real hover states appear on the source
   button, the close button and the Summarize button.
5. The recorder logs measured boxes for the panel, summary, input, question,
   answer, source passage, paragraph, Summarize button, selection and card.
   It samples the card every 0.1 seconds while it loads and streams. The
   composition frames and spotlights the UI from these boxes.
6. JPEG frames go straight into an FFmpeg image pipe. The H.264 yuv444p
   intermediate keeps chroma detail at CRF 15. `generated/` holds the
   footage, a few stills, `action-log.json` and `frame-audit.json`.
7. `build.mjs` writes the action schedule and the SFX WAV from the action
   log, and copies the footage to `usage-soft.mp4` for the focus layer.
8. Hyperframes owns media playback. One paused GSAP timeline controls the
   camera, focus, toolbar, captions, pointer, rings and outro.
9. `finish.mjs` takes the settled summary at 4.6 seconds for
   `docs/shots/demo-poster.jpg`, then encodes `docs/demo.mp4` as H.264
   yuv420p at CRF 20 with AAC and faststart.
10. `mix.mjs` builds the music and SFX mix, replaces the audio with AAC at
    256 kbps, and copies the H.264 stream. It checks the video hash,
    loudness, true peak, size, atom order and keystroke timing before it
    replaces the delivered file.
11. `review.mjs` checks the delivery format and summary timing, then samples
    every 1.5 seconds into `contact-phone.jpg`, with 390 pixel tiles, and
    `contact-full.jpg`. It also saves single phone frames of the toolbar,
    summary, question, answer, source, Summarize button and selection.

## Timeline and captions

Captions use Newsreader at 76 pixels in a band above the UI, so they never
cover the panel. Two of them set up the line in a dimmer color, then land
the point in full white. Each enters over 0.28 seconds and fades out over
0.16 seconds before the next one.

| Time | Caption | Product action |
| --- | --- | --- |
| 0 to 5.75 | A long article. A short answer. | Cursor to the toolbar from 0.47, tooltip at 1.63, click at 1.97, panel opens, summary done at 3.3 |
| 5.75 to 11.55 | Get answers without leaving the page. | Input click at 6.3, typing 6.5 to 7.6, Enter at 7.9, answer done at 8.93 |
| 11.55 to 15.4 | See exactly where the answer came from. | Source click at 12.27, the page scrolls to the passage, close at 15.4 |
| 15.4 to 22.7 | Only need one paragraph? Highlight it. | Scroll, select from 16.5 to 17.33, Summarize button shown, click at 18.9, card done at 20.2 |
| 22.35 to 26.4 | Eternal Summary. Add to Chrome. | Outro with the icon, an "Add to Chrome" button and "Works in Chrome, Brave, Edge and Arc." |

## Camera and focus

The UI sits in an 1824 by 828 viewport at output position 48,204. The
camera moves the whole browser window, a 36 pixel drawn toolbar above
1120 by 630 CSS pixels of footage. In the wide opening shot the window
floats on the page background at scale 1.2. Zoomed in, it fills the
viewport, and the page beside the panel stays in frame.

Moves, in camera CSS pixels:

| Move | Time | Framing |
| --- | --- | --- |
| Push in on the toolbar | 0.5 to 1.55 | Scale 2.3, the window's top right corner with background around it |
| Panel header | 2.05 to 2.75 | Scale 2.35, panel flush right, header, verdict and tabs |
| Summary | 3 to 3.7 | Scale 3.1, centered on the summary text |
| Input | 5.8 to 6.3 | Scale 3.1, the end of the summary, sources and input |
| Question and answer | 7.95 to 8.6 | Fitted to the question and answer, about 2.7 |
| Answer and source side by side | 12.3 to 12.95 | Full width at scale 1.63 |
| Source passage | 13.45 to 13.95 | Fitted to the highlighted passage |
| Paragraph | 15.4 to 16 | Fitted to the paragraph |
| Summarize button | 17.4 to 18 | Fitted to the button and selection |
| Selection card | 18.95 to 19.6 | Fitted to the card's header and text |

Focus uses two copies of the footage. The lower copy fades to
`blur(1.4px) brightness(0.45) saturate(0.6)`, and the toolbar fades with
it. The upper copy is sharp and cropped to the focused UI with a rounded
`clip-path` from the measured boxes. The crop changes only while the
lower copy is clear, so focus fades in and out instead of wiping.
Chrome's `backdrop-filter` was tried first and dropped, because it
mirrored the page text inside a scaled layer.

| Focus | Time |
| --- | --- |
| Panel, page dimmed beside it | 2.1 to 12.7 |
| Source passage | 13.45 to the close move at 14.97 |
| Summarize button, then the card it opens | 17.4 to the outro |

The product clears the source highlight 2.4 seconds after the click. The
passage spotlight stays after the blue goes, and fades before the close
click, because the page reflows when the panel closes. The card spotlight
follows the card's sampled box as it loads and grows.

At scale 3.1, one CSS pixel is 3.1 output pixels from three source pixels,
1.03 times the recorded resolution.

## Audio

There is no voice.

### Music

The mix uses "Happy Beats / Business Moves vol. 12" by Sascha Ende at
[ende.app](https://ende.app/en), under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The
[standard license](https://ende.app/en/standard-license) also makes
attribution optional. The source stays outside Git at
`C:\Users\alitl\.codex\skills\brag\assets\music\happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`.
The strong cue at 8.7423 seconds lands on the toolbar click. The script
checks the cue against the track's JSON in `music/cues/`.

Round 5 set the music six LU below the original. This round keeps that
balance and lifts music and SFX together by 2 dB, so a phone plays the
video at a normal level. The music stem targets -20.04 LUFS. Music keeps
the 65 Hz high-pass, the 3 dB shelf cut above 2.8 kHz, the 11 kHz low-pass
and the peak compressor at threshold 0.1, ratio 3, attack 0.1 ms, release
100 ms and no makeup gain. It enters over 80 ms and fades out across the
outro from 22.35 seconds. Five dB cosine ducks cover the typing through
the source click, and the selection card through the outro. Their ramps
come from the action log. UI clicks keep brief 3 dB dips.

### Keyboard and UI effects

The keyboard samples are eight CC0 files from
[Keyboard Soundpack #1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes)
by unicae_games. Letters use `keypress-003.wav`, `007`, `011`, `014`,
`020` and `025`. Space uses `002` and Enter uses `028`. A seeded generator
picks samples without immediate repeats, with up to 2 dB of gain and
3 percent pitch variation. Base isolated peaks are -19 dBFS for letters,
-17 for Space and -14.5 for Enter, before the shared lift.

The other CC0 samples are from
[Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds). The
toolbar click is -6.5 dBFS, still the loudest click. The other clicks are
-8 and the selection mouse-down is -11. Panel and card openings are -10.5,
35 ms after their clicks, with the seeded 200 ms noise whoosh at -27.

The toolbar click was -5.5 before. With the 2 dB lift it summed with the
music's strong beat to an oversampled peak above the -2.2 dBFS limiter
ceiling. Lowering that one click by 1 dB keeps the mix under the ceiling
without limiting. A 3 dB lift needed more than that, so the lift is 2 dB.

### Delivery measurements

These are measured values from FFmpeg analysis of the delivered file and
the stems in the review directory.

| Signal | Integrated LUFS, loudnorm | Integrated LUFS, ebur128 | True peak dBTP |
| --- | --- | --- | --- |
| Round 5 music stem | -22.04 | -22.0 | -11.52 |
| Music stem | -20.04 target | -19.9 | -10.0 |
| SFX stem after the lift | | -26.8 | -4.4 |
| Round 5 final | -21.95 | -21.9 | -3.83 |
| Final after AAC | -19.93 | -19.7 | -2.72 |

The music excerpt starts at source time 6.7756 seconds, so the strong cue
lands on the toolbar click at 1.967. Its constant gain after filtering and
ducking is +3.97 dB. The premaster measures -2.69 dBTP, under the safety
limiter's -2.2 dBFS ceiling, so the limiter applies no gain reduction. The
limiter keeps 192 kHz oversampling, 5 ms attack, 80 ms release and no
makeup gain. All 22 keystroke cues match the action log with zero timing
error and no immediate sample repeats.

The delivered file is 4,496,815 bytes, 26.4 seconds and 792 frames,
1920 by 1080 at 30 fps, H.264 yuv420p. Audio is AAC stereo at 48 kHz,
about 262 kbps. `moov` comes before `mdat`. The video stream SHA256 is
`7293d9cf4bc2e575524548f32bb73bcc42d0864cca772a2ce24661e7f3e3bedc`, the
same before and after the audio mix.

The recording took under two minutes. The Hyperframes render took about
1 minute 50 seconds with two workers on the VM's GPU. `hyperframes check`
passes with zero runtime, layout, motion and contrast findings. Two
non-blocking lint warnings suggest sub-compositions for the toolbar and
outro. All 70 repo tests pass, along with `npm run check`, syntax checks
on the demo scripts and `git diff --check`.

The contact sheets and transition frames were viewed. At 390 pixels wide,
the captions, summary, answer, passage and card text read. Frames around
each spotlight change were checked one by one, for the cursor at the top
edge after the toolbar click, the crop over reflowing text after the
panel closes, and the empty box before the card fades in. The sheets are
`%TEMP%\es-demo-review-6\contact-phone.jpg` and
`%TEMP%\es-demo-review-6\contact-full.jpg`.

## Included dependencies

- Newsreader variable font from Google Fonts `ofl/newsreader`. The SIL
  Open Font License is in `assets/newsreader-OFL.txt`.
- GSAP 3.15.0. Its copyright notice and standard license link remain
  in `assets/gsap.min.js`.
- The extension's own 32 and 128 pixel icons, copied from `icons/`.
- Hyperframes 0.8.159. No browser, FFmpeg executable, installed package,
  raw footage or render cache is committed.
