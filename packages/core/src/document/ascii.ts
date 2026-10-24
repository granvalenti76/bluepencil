/** Letters that do not decompose into letter + accent (NFD) and that names must keep. */
const LIGATURES: Record<string, string> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
};

/** The text in ASCII letters, for file names and `id`s: "Straße" → "Strasse", "perché" → "perche". */
export function toAscii(text: string): string {
  return text
    .replace(/[ßẞæÆœŒøØłŁ]/g, (c) => LIGATURES[c]!)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
