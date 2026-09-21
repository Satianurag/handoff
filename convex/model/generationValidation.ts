import { Temporal } from "@js-temporal/polyfill";
import * as chrono from "chrono-node";
import { extractionSchema, questionSchema, introductionSchema } from "./generationContract";

const clinical = /\b(diagnos\w*|medicat\w*|dos(?:e|es|age)|insulin|metformin|antibiotic\w*|chemotherapy|prescription|blood sugar|blood pressure|test results?|lab results?|fasting|fast for|nothing (?:to eat|by mouth)|nil by mouth|NPO|stop taking|take \d+\s*(?:mg|mcg|ml|tablets?|pills?)|treatment|surgery preparation)\b/i;
const injection = /(?:ignore (?:all |the |any )?(?:previous|prior|system)|system (?:prompt|instruction)|developer message|reveal (?:the )?(?:API )?(?:secret|key)|send (?:all )?(?:data|secrets)|\b(?:call|invoke|execute)\b.{0,40}\b(?:tool|send_email|function)\b|<\/?(?:system|assistant)>)/i;
const logistics = /\b(entrance|parking|park|lot|address|street|road|avenue|building|suite|floor|accessible|accessibility|ramp|phone|call|telephone|visit|appointment|arrival|arrive|pickup|pick up|groceries|meal|ride|transport|check.in|hours|open|closed|location|bring (?:a |your )?(?:list|notebook|questions|umbrella))\b/i;
export function unsafeGeneratedText(text: string) { return clinical.test(text) || injection.test(text); }
export function redactIdentifiers(value: string, names: string[] = []) {
  let output = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted identifier]")
    .replace(/^(?:patient(?: name)?|name|DOB|date of birth|insurance|policy (?:id|number)|medical record|MRN)\s*[:#].*$/gim, "[redacted identifier]");
  for (const name of names) if (name.trim().length >= 3) output = output.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "[person]");
  return output;
}
export type SourceBlock = { sourceId: string; plaintext: string; kind: "email" | "web" | "manual"; previousText?: string; timezone?: string; capturedAt: number };
export type ValidProposal = { kind: "visit" | "task" | "logistics"; title: string; rawDateText: string | null; field: "startsAt" | "address" | "phone" | "note" | "title" | "dueAt"; proposedValue: string | number | null; sourceId: string; quote: string; start: number; end: number; ambiguityReason: string | null };

export function strictDate(raw: string, zone: string | undefined, reference: number): number | null {
  // Numeric US/EU slash dates and abbreviations like CST are ambiguous.
  if (/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b(?:today|tomorrow|yesterday|next|this|CST|EST|PST|IST|BST)\b/i.test(raw)) return null;
  const parsed = chrono.en.strict.parse(raw, new Date(reference));
  if (parsed.length !== 1 || parsed[0].end) return null;
  const c = parsed[0].start;
  if (!["year", "month", "day", "hour"].every(key => c.isCertain(key as "year" | "month" | "day" | "hour"))) return null;
  const hour = c.get("hour")!;
  if (hour <= 12 && !/\b(?:a\.?m\.?|p\.?m\.?)\b|T\d{2}:|\b(?:00|0[1-9]|1[3-9]|2[0-3]):/i.test(raw)) return null;
  try {
    const date = Temporal.PlainDateTime.from({ year: c.get("year")!, month: c.get("month")!, day: c.get("day")!, hour, minute: c.get("minute") ?? 0, second: c.get("second") ?? 0 }, { overflow: "reject" });
    const offset = c.isCertain("timezoneOffset") ? c.get("timezoneOffset") : null;
    if (offset !== null) return date.toZonedDateTime("UTC").epochMilliseconds - offset * 60000;
    if (!zone) return null;
    return date.toZonedDateTime(zone, { disambiguation: "reject" }).epochMilliseconds;
  } catch { return null; }
}

export function validateExtraction(raw: unknown, source: SourceBlock) {
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.proposals.length > 30) throw new Error("MODEL_SCHEMA_INVALID");
  const accepted: ValidProposal[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const p of parsed.data.proposals) {
    const start = source.plaintext.indexOf(p.quote), end = start + p.quote.length;
    const invalid = p.sourceId !== source.sourceId || start < 0 || p.quote.length < 4 || p.quote.length > 2000 || p.title.length > 160 || !!p.ambiguityReason || unsafeGeneratedText(p.quote + " " + String(p.proposedValue ?? "") + " " + p.title) || !logistics.test(p.quote) || /\[redacted|\[person\]/.test(p.quote) || (source.previousText?.includes(p.quote) ?? false);
    if (invalid) { rejected++; continue; }
    let value = p.proposedValue;
    if (p.field === "startsAt" || p.field === "dueAt") {
      const valueAt = p.rawDateText && p.quote.includes(p.rawDateText) ? strictDate(p.rawDateText, source.timezone, source.capturedAt) : null;
      if (source.kind === "web" || valueAt === null || valueAt < 0 || valueAt > 4102444800000 || value !== p.rawDateText) { rejected++; continue; }
      value = valueAt;
    } else {
      if (typeof value !== "string" || !value.trim() || !p.quote.includes(value) || value.length > (p.field === "title" ? 160 : p.field === "phone" ? 80 : p.field === "address" ? 1000 : 4000)) { rejected++; continue; }
      if (p.field === "phone" && !/[+\d][\d\s().-]{5,}\d/.test(value)) { rejected++; continue; }
    }
    const key = `${p.field}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key); accepted.push({ ...p, proposedValue: value, start, end });
  }
  return { proposals: accepted, rejected, abstentionReason: parsed.data.abstentionReason?.slice(0, 500) ?? null };
}

export function validateQuestion(raw: unknown, sources: Array<{ sourceId: string; plaintext: string }>) {
  const parsed = questionSchema.safeParse(raw);
  if (!parsed.success) throw new Error("MODEL_SCHEMA_INVALID");
  const value = parsed.data;
  if (!value.subject.trim() || value.subject.length > 200 || /[\r\n]/.test(value.subject) || !value.body.trim() || value.body.length > 20000 || value.references.length > 20 || unsafeGeneratedText(value.subject + " " + value.body) || /https?:\/\/|[^\s@]+@[^\s@]+\.[^\s@]+/.test(value.body) || /\b(on behalf of|I am (?:the|a) (?:doctor|nurse)|guarantee|diagnosis)\b/i.test(value.body)) throw new Error("MODEL_CONTENT_INVALID");
  const references = value.references.map(ref => {
    const source = sources.find(s => s.sourceId === ref.sourceId), start = source?.plaintext.indexOf(ref.quote) ?? -1;
    if (!source || start < 0 || ref.quote.length < 4 || ref.quote.length > 2000 || unsafeGeneratedText(ref.quote)) throw new Error("MODEL_EVIDENCE_INVALID");
    return { ...ref, start, end: start + ref.quote.length };
  });
  return { ...value, references };
}

export function validateIntroduction(raw: unknown, eventIds: string[]) {
  const parsed = introductionSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.introduction.trim() || parsed.data.introduction.length > 2000 || parsed.data.eventIds.some(id => !eventIds.includes(id)) || unsafeGeneratedText(parsed.data.introduction) || /\b(?:you (?:have |now )?(?:accepted|own|took)|all (?:work|tasks) (?:is|are) (?:done|complete)|handover (?:is )?accepted)\b/i.test(parsed.data.introduction)) throw new Error("MODEL_INTRODUCTION_INVALID");
  return parsed.data;
}
