# Dial Tone — Channel Spike

Throwaway research rig to answer one question before we design anything:
**Which ggwave protocol survives which channel?**

This folder is *not* the product repo. Keep the findings and leave the code here: the real app gets built from scratch in Kiro.

## What's here

| File | What it does |
|---|---|
| `index.html` | Test page: live transmit/listen with a spectrogram, decode an uploaded recording, field log with CSV export, the simulation table and the Opus voice-note test |
| `channels.js` | Channel simulators (room, classic phone call, walkie-talkie good/weak) and ggwave helpers |
| `sim-node.mjs` | Same simulation from the command line |
| `sim-results.txt` | Last command-line run (10 messages per cell) |
| `vendor/ggwave.js` | ggwave v0.4.0 (MIT; see `vendor/GGWAVE-LICENSE.txt`) |

Run locally: `npx http-server@14.1.1 dial-tone/spike -p 5173`, then open http://localhost:5173.
The microphone works on `localhost`. **Phones need HTTPS** (see Field test below).

## Results so far (simulated, Nov 13)

**Simulated channels:** 10 random 24-character messages per cell (Node); the browser gave the same result at 5 per cell.

| Protocol | sec/msg* | Clean | Room | Phone call (G.711) | Walkie (good) | Walkie (weak) |
|---|---|---|---|---|---|---|
| Audible · normal / fast / fastest | 3.0 / 2.2 / 1.5 | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Dual-tone · normal / fast / fastest** | 7.4 / 5.2 / 2.9 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ultrasound · normal / fastest | 3.0 / 1.5 | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ultrasound · fast | 2.2 | ✅ | ❌ (odd, check live) | ❌ | ❌ | ❌ |

\* for a 24-character message, including start/end markers

**Opus voice-note codec:** the browser's real encoder. Cells show how many of 4 decoder alignments recovered the message.

| Protocol | 12 kbps | 16 kbps | 24 kbps | 32 kbps |
|---|---|---|---|---|
| Audible · fast | 4/4 | 4/4 | 0/4 | 0/4 |
| Dual-tone · fast | 4/4 | 4/4 | 0/4 | 0/4 |
| Dual-tone · fastest | 4/4 | 4/4 | 2/4 | 0/4 |
| Ultrasound · fast | 0/4 | 0/4 | 0/4 | 0/4 |

### What this means for the product
1. **Dual-tone (DT) is our "Radio/Phone" mode.** Its tones sit around 1.1–2.6 kHz, inside the voice band. It's the only family that survived every narrowband channel. **DT · fastest** (~3 s per message) is the sweet spot.
2. **Audible is the "Room" mode** (fastest is 1.5 s), but it dies on any narrowband path because its tones reach ~6.4 kHz.
3. **Ultrasound is only for short-range "Quiet" mode.** Nothing narrowband carries it.
4. **Voice notes probably work at low bitrates and fail at higher ones.** That's the reverse of what you'd expect, and the cause is unverified. My guess: Opus switches to its music mode (CELT) above ~20 kbps. Voice-note apps generally use low bitrates, so this may work in practice, but only a real field test will tell.
5. **Decoder alignment matters.** Through Opus at 32 kbps, one message decoded at 1 of 4 frame offsets. Product idea: run 3–4 decoders in parallel, offset by 256 samples. It's cheap, makes reception sturdier, and is a good spec plus property-based-testing story.

### What the simulation does NOT cover (needs the field test)
- Modern phone calls use AMR / AMR-WB / EVS speech codecs, not G.711. Speech codecs can mangle pure tones in ways a filter model can't predict.
- Real phone speakers and mics, room acoustics, and real walkie-talkie squelch/VOX behaviour
- The noise suppression voice-note apps apply while recording

## Field test (do this next, ~1 hour)

**Host it over HTTPS** (needed for the mic on phones). The quickest way is to drag the `spike` folder onto Netlify Drop (app.netlify.com/drop). GitHub Pages works too.

On both phones: open the page → **Enable audio + mic** → allow the microphone.

For each channel, send **5 messages each** in DT · fastest, DT · fast and Audible · fastest:

| # | Channel | How |
|---|---|---|
| 1 | Room | Phone A transmits, phone B listens from 1 m, then 3 m |
| 2 | Mobile call | Call B from A on speaker. B listens with the page on a *third* device (laptop) next to B's speaker. Or put A's speaker next to its own mic during the call. |
| 3 | Internet call | Same setup, using an internet voice-call app |
| 4 | Walkie-talkie | A transmits into radio 1 (push-to-talk held). Phone B listens next to radio 2. |
| 5 | Voice note | Record a voice note while A transmits, send it to yourself, play it next to phone B. Or download the file and use **Decode a recording**. |

Messages are auto-tagged (`[DTX·walkie·03]`). Each phone keeps a log; export CSV from both and drop them in this folder. **Success rule:** a channel "works" if it gets 4 of 5 messages through in DT · fastest.

## Decisions this unlocks
- Which channel modes the product and video can promise
- Whether we need our own narrowband protocol (only if DT fails real calls or radios)
- The spectrogram's display range for the visual design (0–4 kHz shows DT nicely; Room mode needs 0–8 kHz)
