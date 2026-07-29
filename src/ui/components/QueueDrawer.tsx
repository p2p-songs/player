/** Up-next drawer. Reads play order, so it stays correct under shuffle. */
import { useUpNext, usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { PlayableArtwork, formatTime } from "./common.js";
import { Row, RowIndex, RowMain, RowTime, Rows, StateBlock } from "./primitives.js";
import { Button } from "@/components/ui/button";

export function QueueDrawer() {
  const open = useUi((s) => s.queueOpen);
  const toggle = useUi((s) => s.toggleQueue);
  const upNext = useUpNext();
  const { selectItem } = usePlayer();

  if (!open) return null;

  return (
    <aside
      aria-label="Queue"
      className="fixed top-0 right-0 bottom-0 z-40 flex w-full flex-col border-l-2 border-border bg-card shadow-xl sm:w-85 md:bottom-(--player-bar-h)"
    >
      <div className="flex items-center justify-between border-b-2 border-border px-4 py-3">
        <span className="font-head text-xs uppercase tracking-[0.14em]">Up next</span>
        <Button size="xs" variant="outline" onClick={toggle}>
          Close
        </Button>
      </div>
      <div className="overflow-y-auto">
        {upNext.length === 0 ? (
          <StateBlock icon="♪" title="Nothing up next" message="Play something to build a queue." />
        ) : (
          <Rows flush>
            {upNext.map((item, i) => (
              <Row key={item.id} onClick={() => selectItem(item.id)}>
                <RowIndex>{i + 1}</RowIndex>
                <PlayableArtwork src={item.track.artwork} alt={item.track.title} seed={item.track.recordingId} size={32} />
                <RowMain title={item.track.title} sub={item.track.artist ?? "Unknown artist"} />
                <RowTime>{formatTime(item.track.durationMs)}</RowTime>
              </Row>
            ))}
          </Rows>
        )}
      </div>
    </aside>
  );
}
