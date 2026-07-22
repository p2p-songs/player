/** Up-next drawer (mockup panel 6's Queue tab). Reads play order, so it stays correct under shuffle. */
import { useUpNext, usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { Artwork, formatTime, StateBlock } from "./common.js";

export function QueueDrawer() {
  const open = useUi((s) => s.queueOpen);
  const toggle = useUi((s) => s.toggleQueue);
  const upNext = useUpNext();
  const { selectItem } = usePlayer();

  if (!open) return null;

  return (
    <aside className="queue-drawer" aria-label="Queue">
      <div className="queue-head">
        <span>Up next</span>
        <button type="button" className="btn btn-sm" onClick={toggle}>
          Close
        </button>
      </div>
      <div className="queue-body">
        {upNext.length === 0 ? (
          <StateBlock icon="♪" title="Nothing up next" message="Play something to build a queue." />
        ) : (
          <div className="rows rows-flush">
            {upNext.map((item, i) => (
              <button key={item.id} type="button" className="row" onClick={() => selectItem(item.id)}>
                <span className="row-index">{i + 1}</span>
                <Artwork src={item.track.artwork} alt={item.track.title} size={32} />
                <span className="row-main">
                  <span className="row-title">{item.track.title}</span>
                  <span className="row-sub">{item.track.artist ?? "Unknown artist"}</span>
                </span>
                <span className="row-time">{formatTime(item.track.durationMs)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
