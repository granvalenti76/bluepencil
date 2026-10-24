import { useEffect, useState } from "react";
import { api, initToken, type WelcomeState } from "./api.ts";
import { App } from "./App.tsx";
import { Welcome } from "./Welcome.tsx";

/**
 * First of all, the first start: until it is done, the welcome takes the place of the app. If the
 * server cannot tell, the app opens.
 */
export function Root() {
  const [token] = useState(() => initToken());
  const [welcome, setWelcome] = useState<WelcomeState | "app" | null>(token ? null : "app");
  useEffect(() => {
    if (!token) return;
    api
      .welcome()
      .then((w) => setWelcome(w.pending ? w : "app"))
      .catch(() => setWelcome("app"));
  }, [token]);
  if (welcome === null) return null;
  if (welcome === "app") return <App />;
  return <Welcome state={welcome} />;
}
