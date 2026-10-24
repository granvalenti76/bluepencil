export type ModelErrorCode =
  "unreachable" | "http" | "timeout" | "aborted" | "truncated" | "invalid_json" | "bad_stream";

const MESSAGES: Record<ModelErrorCode, string> = {
  unreachable: "Model unreachable",
  http: "The model server returned an error",
  timeout: "The model hasn’t responded for too long",
  aborted: "Request cancelled",
  truncated: "Response cut off: the model ran out of its token budget",
  invalid_json: "The model didn’t return valid JSON",
  bad_stream: "Invalid response stream",
};

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  readonly status?: number;
  readonly detail?: string;
  constructor(
    code: ModelErrorCode,
    detail?: string,
    opts: { status?: number; cause?: unknown } = {},
  ) {
    super(detail ? `${MESSAGES[code]}: ${detail}` : MESSAGES[code], { cause: opts.cause });
    this.name = "ModelError";
    this.code = code;
    this.status = opts.status;
    this.detail = detail;
  }
}

export const isModelError = (e: unknown, code?: ModelErrorCode): e is ModelError =>
  e instanceof ModelError && (code === undefined || e.code === code);
