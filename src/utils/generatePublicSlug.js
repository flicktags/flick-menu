import crypto from "crypto";

// Avoid confusing chars (0/O, 1/I, etc.)
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randChars(len) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function randDigits(len) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += String(bytes[i] % 10);
  }
  return out;
}

// Format: X223-4kkfkk482jjdjjlk2344-5666  (no "br_" prefix)
export function generatePublicSlug() {
  const prefix = `${randChars(1)}${randDigits(3)}`;       // e.g. X223
  const middle = randChars(20).toLowerCase();             // e.g. 4kkfkk482jjdjjlk2344
  const suffix = randDigits(4);                           // e.g. 5666
  return `${prefix}-${middle}-${suffix}`;
}
