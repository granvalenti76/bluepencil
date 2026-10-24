import { splitFrontMatter } from "@desk/core";
import type { JudgmentKind, TrackedJudgment } from "../editor/judgmentsField.ts";

const KINDS: JudgmentKind[] = ["grammar", "prose", "fact", "fact-ok"];

/**
 * About 6,200 words (the Turbocode draft and the styles sample, repeated 6 times) and 100
 * scattered judgments.
 */
export function buildStress(
  source: string,
  styles: string,
): { doc: string; judgments: TrackedJudgment[] } {
  const { body, bodyOffset } = splitFrontMatter(source);
  const head = source.slice(0, bodyOffset);
  // The `[^n]` footnotes of the styles sample stay only in the last copy.
  const [stylesBody, notes] = styles.split(/\n---\n/);
  const block = body.trimEnd() + "\n\n" + stylesBody!.trimEnd();
  const doc =
    head + Array.from({ length: 6 }, () => block).join("\n\n") + "\n\n---\n" + notes!.trimStart();

  const judgments: TrackedJudgment[] = [];
  const word = /[A-Za-zÀ-ÿ]{6,}/g;
  word.lastIndex = bodyOffset;
  for (let m = word.exec(doc), i = 0; m && judgments.length < 100; m = word.exec(doc), i++) {
    if (i % 15 !== 7) continue;
    judgments.push({
      id: `x${judgments.length}`,
      kind: KINDS[judgments.length % KINDS.length]!,
      from: m.index,
      to: m.index + m[0].length,
      status: "open",
    });
  }
  return { doc, judgments };
}
