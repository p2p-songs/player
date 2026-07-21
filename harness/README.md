# P-2 audio harness (throwaway)

A tiny dev page to **hear** the real audio subsystem — the one thing the headless
test suite can't prove. It wires the real `HtmlAudioBackend` + `Engine` +
MediaSession to hardcoded direct URLs (§10 P-2 = "playing hardcoded direct
URLs"). It is **not** the app (that's P-5) and bypasses addon resolution (P-3,
already covered by the live e2e test) with a trivial direct-URL resolver.

## Run

```
pnpm harness      # vite dev server, opens the page
```

(`pnpm harness:build` just checks it bundles.)

## Manual smoke — what to verify by ear

1. **Plain playback.** Press **Play** → you should hear Track 1. The status box
   shows `playback: playing` and the position counting up.
2. **Pause / seek.** **Pause** stops sound; **Play** resumes. **Seek 30s** jumps
   ahead (audible + position jumps).
3. **Gapless (engine-driven).** Let a track play a few seconds (so the next one
   prefetches + preloads into the idle element), then press **Next** — the switch
   should be seamless (the preloaded element is swapped in, not reloaded).
4. **Crossfade (mechanism).** Press **⤫ Crossfade to next** mid-track — you should
   hear the current track fade down while the next fades up over ~3s.
5. **OS media controls (MediaSession).** With something playing, use your
   keyboard media keys / lock screen / notification — Play/Pause/Next/Prev should
   control the harness, and the track title ("Track N — Harness") should show.

The default URLs are third-party test MP3s (SoundHelix). Replace them in the
textarea with any reachable direct audio URLs (e.g. real Creative-Commons /
public-domain catalog links) and press **Set queue**.

> Note: the anticipatory crossfade *trigger* (auto-start the fade N seconds before
> a track ends) is not wired to the engine yet — it rides with the deferred
> position-timing work (ARCHITECTURE §4b/§4c). The **Crossfade** button
> demonstrates the mechanism directly.
