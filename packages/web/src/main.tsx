import { createRoot } from "react-dom/client";
import "./theme/fonts.css";
import "./theme/tokens.css";
import "./theme/app.css";
import "./theme/design.css";
import { Root } from "./app/Root.tsx";
import { Lab } from "./lab/Lab.tsx";

// No router: /lab is the editor's test page.
const Page = location.pathname === "/lab" ? Lab : Root;

// Inside the desktop app (Electron) the title bar is integrated: the styles account for it. The
// window remembers it even if a reload loses the parameter.
if (new URLSearchParams(location.search).get("shell") === "desktop" || rememberedShell()) {
  document.documentElement.dataset.shell = "desktop";
  try {
    sessionStorage.setItem("desk-shell", "desktop");
  } catch {
    /* the parameter stays */
  }
}

function rememberedShell(): boolean {
  try {
    return sessionStorage.getItem("desk-shell") === "desktop";
  } catch {
    return false;
  }
}

createRoot(document.getElementById("root")!).render(<Page />);
