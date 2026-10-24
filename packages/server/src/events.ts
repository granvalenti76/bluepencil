import { EventEmitter } from "node:events";
import type { Judgment, ModelStatus, ReviewStep } from "@desk/core";
import type { StoredLetter } from "./index-db/letters.ts";
import type { StoredScore } from "./index-db/scores.ts";

export type DeskEvent =
  | {
      type: "draft.changed";
      path: string;
      contentHash: string | null;
      change: "add" | "change" | "unlink";
    }
  | { type: "model.status"; status: ModelStatus }
  /** The language packs changed (user files edited, reloaded, created). */
  | { type: "languages.changed" }
  | ({ type: "review.progress" } & ReviewProgress)
  | {
      type: "judgment.created";
      runId: string;
      path: string;
      judgments: Judgment[];
      /** Judgments superseded by the new check of the same block: they disappear. */
      removed: string[];
    }
  | { type: "review.done"; runId: string; path: string; cancelled: boolean; stats: ReviewStats }
  | { type: "review.score"; runId: string; path: string; score: StoredScore }
  | { type: "review.letter"; runId: string; path: string; letter: StoredLetter }
  | {
      type: "review.error";
      runId: string;
      path: string;
      code: string;
      message: string;
      fatal: boolean;
    };

export type ReviewPhase = "queued" | "busy" | "reasoning" | "writing" | "cached";

export interface ReviewProgress {
  runId: string;
  path: string;
  step: ReviewStep;
  stepIndex: number;
  stepCount: number;
  phase: ReviewPhase;
  reasoningTokens?: number;
}

export interface ReviewStats {
  /** Analyses run (from the cache or from the model). */
  steps: number;
  cached: number;
  modelCalls: number;
  judgments: number;
  errors: number;
  elapsedMs: number;
}

/** The server's event bus, forwarded to the browsers via SSE. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(event: DeskEvent) {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: DeskEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
