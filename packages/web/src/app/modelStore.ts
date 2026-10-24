import { create } from "zustand";
import type { ModelStatus } from "@desk/core";
import { api } from "./api.ts";

interface ModelState {
  status: ModelStatus | null;
  /** The author chose the cloud for the next requests. Not persisted. */
  cloud: boolean;
  setStatus: (status: ModelStatus) => void;
  toggleCloud: () => void;
  load: () => Promise<void>;
}

export const useModel = create<ModelState>()((set, get) => ({
  status: null,
  cloud: false,
  setStatus: (status) => set((s) => ({ status, cloud: s.cloud && status.cloud.available })),
  toggleCloud: () => {
    if (get().status?.cloud.available) set((s) => ({ cloud: !s.cloud }));
  },
  load: async () => {
    try {
      get().setStatus(await api.modelStatus());
    } catch {
      /* the server will answer with the model.status event */
    }
  },
}));
