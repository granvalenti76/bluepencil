import { useDoc } from "./docStore.ts";
import { session } from "./session.ts";

export function ConflictBanner() {
  const status = useDoc((s) => s.status);
  if (status !== "conflict") return null;
  return (
    <div className="banner" role="alert">
      <span className="banner-text">The file changed on disk.</span>
      <button className="btn-secondary btn-small" onClick={() => void session.reload()}>
        Reload
      </button>
      <button className="btn-secondary btn-small" onClick={() => void session.keepMine()}>
        Keep my version
      </button>
    </div>
  );
}
