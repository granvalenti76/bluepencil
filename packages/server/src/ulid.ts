import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 48 bits of time + 80 of randomness, in base 32 (sortable by creation date). */
export function ulid(now = Date.now()): string {
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ALPHABET[t % 32]! + time;
  const rand = randomBytes(16);
  let random = "";
  for (let i = 0; i < 16; i++) random += ALPHABET[rand[i]! % 32];
  return time + random;
}
