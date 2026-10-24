import { getToken } from "./api.ts";
import { useLanguages } from "./languages.ts";
import { letters } from "./letters.ts";
import { useModel } from "./modelStore.ts";
import { passes } from "./passes.ts";
import { review } from "./review.ts";
import { session } from "./session.ts";

/** SSE to the server: `EventSource` sends no headers, so the token goes in the `t` parameter. */
export function connectEvents(): () => void {
  const token = getToken();
  if (!token) return () => {};
  const source = new EventSource(`/api/events?t=${encodeURIComponent(token)}`);
  source.addEventListener("draft.changed", (ev) => {
    void session.onDraftChanged(JSON.parse((ev as MessageEvent<string>).data));
  });
  const on = (type: string, fn: (data: never) => void) =>
    source.addEventListener(type, (ev) =>
      fn(JSON.parse((ev as MessageEvent<string>).data) as never),
    );
  on("review.progress", review.onProgress);
  on("judgment.created", review.onJudgments);
  on("review.done", (e: Parameters<typeof review.onDone>[0]) => {
    review.onDone(e);
    void passes.refresh();
  });
  on("review.error", review.onError);
  on("review.score", review.onScore);
  on("review.letter", letters.onLetter);
  source.addEventListener("model.status", (ev) => {
    useModel.getState().setStatus(JSON.parse((ev as MessageEvent<string>).data).status);
  });
  // A user language pack edited, created or reloaded.
  source.addEventListener("languages.changed", () => void useLanguages.getState().load());
  // After a reconnection the state may have changed without an event.
  source.addEventListener("open", () => void useModel.getState().load());
  return () => source.close();
}
