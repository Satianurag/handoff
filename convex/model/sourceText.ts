import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function digest(text: string) { return bytesToHex(sha256(utf8ToBytes(text))); }

export function sourceText(text: string) {
  // Quotes and offsets refer to this stored representation. Preserve line
  // boundaries; collapse horizontal whitespace and normalize CRLF/NBSP.
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").split("\n").map(line => line.replace(/[\t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  let bounded = normalized.slice(0, 60000);
  while (utf8ToBytes(bounded).length > 120000) bounded = bounded.slice(0, Math.floor(bounded.length * 0.9));
  return { plaintext: bounded, truncated: bounded.length < normalized.length, contentHash: digest(bounded) };
}

export function logisticsHash(text: string) {
  const lines = text.split("\n").filter(line => /\b(entrance|parking|accessible|address|hours|location|bring|building|street|avenue|road|suite|visitor|visiting)\b/i.test(line) && !/copyright|all rights reserved|privacy policy|terms of (use|service)|cookie/i.test(line));
  return digest(lines.map(line => line.toLowerCase().replace(/\s+/g, " ")).sort().join("\n"));
}
