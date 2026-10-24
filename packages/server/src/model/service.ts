import { appendFileSync } from "node:fs";
import {
  ModelClient,
  ModelError,
  slotFor,
  type ModelDebugEvent,
  type ModelStatus,
  type ServerProps,
} from "@desk/core";
import type { Config } from "../config.ts";
import type { EventBus } from "../events.ts";

export interface ModelServiceOptions {
  /** How often to check llama-server again; 0 = never (tests). */
  pollMs?: number;
  env?: NodeJS.ProcessEnv;
  idleTimeoutMs?: number;
  /** How often to check `/slots` again while the server works for others. */
  busyPollMs?: number;
}

const STATUS_TIMEOUT_MS = 3000;

/**
 * Gateway to llama-server (and to the cloud, only if chosen). Checks reachability at startup and
 * periodically, and sends `model.status` when it changes.
 */
export class ModelService {
  readonly local: ModelClient;
  private readonly cloudClient: ModelClient | null;
  private current: ModelStatus;
  private timer: NodeJS.Timeout | null = null;
  private props: ServerProps | null | undefined;
  private readonly bus: EventBus;
  private readonly opts: ModelServiceOptions;

  constructor(config: Config, bus: EventBus, opts: ModelServiceOptions = {}) {
    this.bus = bus;
    this.opts = opts;
    const env = opts.env ?? process.env;
    const logPath = env.DESK_MODEL_LOG;
    const debug = logPath
      ? (e: ModelDebugEvent) =>
          appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n")
      : undefined;

    this.local = new ModelClient({
      endpoint: { kind: "local", baseUrl: config.model.baseUrl },
      idleTimeoutMs: opts.idleTimeoutMs,
      debug,
    });

    const { cloud } = config;
    const key = env[cloud.apiKeyEnv];
    let reason: string | undefined;
    if (!cloud.enabled) reason = "not enabled in the configuration";
    else if (!cloud.baseUrl) reason = "cloud.baseUrl is missing";
    else if (!key) reason = `the ${cloud.apiKeyEnv} environment variable is missing`;
    this.cloudClient =
      reason === undefined
        ? new ModelClient({
            endpoint: { kind: "cloud", baseUrl: cloud.baseUrl, model: cloud.model, apiKey: key },
            idleTimeoutMs: opts.idleTimeoutMs,
            debug,
          })
        : null;

    this.current = {
      local: { baseUrl: config.model.baseUrl, reachable: false, model: null, checkedAt: null },
      cloud: {
        enabled: cloud.enabled,
        available: this.cloudClient !== null,
        model: cloud.model || null,
        ...(reason ? { reason } : {}),
      },
    };
  }

  status(): ModelStatus {
    return this.current;
  }

  /** The client for a request: the cloud only if the author chose it and it is available. */
  client(useCloud = false): ModelClient {
    if (!useCloud) return this.local;
    if (!this.cloudClient) {
      throw new ModelError("unreachable", `cloud unavailable (${this.current.cloud.reason})`);
    }
    return this.cloudClient;
  }

  /** Model name to record in judgments and fingerprints. */
  modelName(useCloud = false): string {
    return useCloud ? (this.current.cloud.model ?? "cloud") : (this.current.local.model ?? "local");
  }

  /**
   * A fixed slot per draft (`id_slot`), if the server has more than one. With a single slot
   * (`parallel 1`) it is not needed: every request ends up there anyway.
   */
  async slotFor(draftPath: string): Promise<number | undefined> {
    if (this.props === undefined) this.props = await this.local.props();
    const n = this.props?.totalSlots;
    return n && n > 1 ? slotFor(draftPath, n) : undefined;
  }

  /** Requests waiting for their turn (including the one in progress). */
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();

  /**
   * Runs a queued model call: **one at a time** for the whole app (review, structure, section
   * drafts), because llama-server is shared and often has a single slot. Before starting, if the
   * server is already working for another app (`/slots`), it waits and says so with
   * `onWait("busy")`: this way the client's timeout does not fire while queued.
   */
  async run<T>(
    fn: (client: ModelClient) => Promise<T>,
    opts: { cloud?: boolean; signal?: AbortSignal; onWait?: (w: "queued" | "busy") => void } = {},
  ): Promise<T> {
    const client = this.client(opts.cloud);
    const prev = this.tail;
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.tail = prev.then(() => mine);
    this.pending++;
    try {
      if (this.pending > 1) opts.onWait?.("queued");
      await abortable(prev, opts.signal);
      if (client.isLocal) await this.waitForIdleServer(client, opts.signal, opts.onWait);
      return await fn(client);
    } finally {
      this.pending--;
      release();
    }
  }

  private async waitForIdleServer(
    client: ModelClient,
    signal: AbortSignal | undefined,
    onWait?: (w: "queued" | "busy") => void,
  ) {
    for (let first = true; ; first = false) {
      const slots = await client.slots(signal).catch(() => null);
      if (!slots || slots.every((s) => !s.busy)) return;
      if (first) onWait?.("busy");
      await abortable(new Promise((r) => setTimeout(r, this.opts.busyPollMs ?? 3000)), signal);
    }
  }

  /** The server's context (tokens), if `/props` reports it. */
  async contextSize(): Promise<number | undefined> {
    if (this.props === undefined) this.props = await this.local.props();
    return this.props?.nCtx;
  }

  async refresh(): Promise<ModelStatus> {
    const prev = this.current.local;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    let local: ModelStatus["local"];
    try {
      const models = await this.local.listModels(controller.signal);
      local = { ...prev, reachable: true, model: models[0] ?? null, checkedAt: now() };
      delete local.error;
    } catch (e) {
      const error = controller.signal.aborted ? "timeout" : (e as Error).message;
      local = { ...prev, reachable: false, error, checkedAt: now() };
    } finally {
      clearTimeout(t);
    }
    const changed =
      local.reachable !== prev.reachable ||
      local.model !== prev.model ||
      local.error !== prev.error;
    // A server that is reachable again may be a different one: read `/props` again.
    if (changed) this.props = undefined;
    this.current = { ...this.current, local };
    if (changed) this.bus.emit({ type: "model.status", status: this.current });
    return this.current;
  }

  start() {
    void this.refresh();
    const ms = this.opts.pollMs ?? 30_000;
    if (ms > 0) {
      this.timer = setInterval(() => void this.refresh(), ms);
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const now = () => new Date().toISOString();

/** Waits for `p`, but exits at once (with `ModelError("aborted")`) if the signal fires. */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new ModelError("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ModelError("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
