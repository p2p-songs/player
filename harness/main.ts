/**
 * P-2 audio harness (throwaway; NOT the app). Wires the *real* HtmlAudioBackend
 * + Engine + MediaSession to hardcoded direct URLs (§10 P-2 = "playing hardcoded
 * direct URLs") so a human can hear real playback, the gapless preload→swap on
 * Next, the volume-automation crossfade, and OS media controls — the parts
 * headless tests can't prove. Addon resolution is P-3 and is covered by the live
 * e2e test; this harness deliberately bypasses it with a trivial resolver.
 */
import type { Stream } from "@p2p-songs/protocol";
import { Engine } from "../src/core/engine/engine.js";
import { HtmlAudioBackend } from "../src/core/audio/html-audio.js";
import { bindMediaSession } from "../src/core/audio/media-session.js";
import type { Resolver, ResolveOutcome } from "../src/core/scheduler/resolver.js";
import type { TrackRef } from "../src/core/queue/types.js";

const DEFAULT_URLS = [
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
];

/** Maps a track's synthetic recording id back to its direct URL. */
class DirectUrlResolver implements Resolver {
  urls = new Map<string, string>();
  async resolve(track: TrackRef): Promise<ResolveOutcome> {
    const url = this.urls.get(track.recordingId);
    return url ? { ok: true, streams: [{ url, name: "direct" } as Stream] } : { ok: false, reason: "no url for track" };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const urlsField = $<HTMLTextAreaElement>("urls");
const statusBox = $<HTMLDivElement>("status");
urlsField.value = DEFAULT_URLS.join("\n");

const resolver = new DirectUrlResolver();
const backend = new HtmlAudioBackend();
const engine = new Engine(resolver, backend);
bindMediaSession(engine);

/** Current URL list + the synthetic tracks built from it. */
let urls: string[] = [];
function buildQueue(): void {
  urls = urlsField.value.split("\n").map((u) => u.trim()).filter(Boolean);
  resolver.urls.clear();
  const tracks: TrackRef[] = urls.map((url, i) => {
    const recordingId = `mbid:recording:${String(i + 1).padStart(8, "0")}-0000-0000-0000-000000000000` as TrackRef["recordingId"];
    resolver.urls.set(recordingId, url);
    return { recordingId, title: `Track ${i + 1}`, artist: "Harness", album: "P-2 smoke" };
  });
  engine.setQueue(tracks);
  render();
}

engine.subscribe(render);
function render(): void {
  const s = engine.getState();
  const cur = s.queue.currentItemId ? s.queue.itemsById[s.queue.currentItemId] : undefined;
  const pb = s.playback as { status: string; positionMs?: number; url?: string };
  statusBox.textContent = [
    `playback: ${pb.status}`,
    `position: ${((pb.positionMs ?? 0) / 1000).toFixed(1)}s`,
    `current:  ${cur ? cur.track.title : "—"}`,
    `url:      ${"url" in pb && pb.url ? pb.url : "—"}`,
    `queue:    ${s.queue.playOrder.length} track(s)`,
  ].join("\n");
}

// Engine-driven controls.
$("load").onclick = buildQueue;
$("play").onclick = () => engine.play();
$("pause").onclick = () => engine.pause();
$("next").onclick = () => engine.next();
$("prev").onclick = () => engine.prev();
$("seek30").onclick = () => engine.seek(30000);

// Direct backend crossfade demo (bypasses the FSM to audibly show the volume ramp).
$("crossfade").onclick = () => {
  const s = engine.getState();
  const order = s.queue.playOrder;
  const curId = s.queue.currentItemId;
  const idx = curId ? order.indexOf(curId) : -1;
  const nextUrl = urls[idx + 1];
  if (nextUrl) backend.crossfadeTo(nextUrl, `harness-crossfade-${idx + 1}`, 3000);
};

buildQueue();
