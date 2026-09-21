import { v } from "convex/values";
import { localDate, wallTime } from "./model/recurrence";
import { member, timestamp, timezone, userQuery } from "./model/access";

export const resolveLocal = userQuery({
  args: { householdId: v.id("households"), timezone: v.string(), date: v.string(), time: v.string(), choice: v.optional(v.union(v.literal("earlier"), v.literal("later"))) },
  returns: v.object({ kind: v.union(v.literal("exact"), v.literal("ambiguous"), v.literal("gap")), choices: v.array(v.object({ epochMilliseconds: v.number(), offset: v.string(), label: v.string() })) }),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId,false,true);
    const plain = localDate(args.date).toPlainDateTime(wallTime(args.time));
    const zone = timezone(args.timezone);
    const earlier = plain.toZonedDateTime(zone, { disambiguation: "earlier" });
    const later = plain.toZonedDateTime(zone, { disambiguation: "later" });
    if (!earlier.toPlainDateTime().equals(plain) || !later.toPlainDateTime().equals(plain)) return { kind: "gap" as const, choices: [] };
    timestamp(earlier.epochMilliseconds); timestamp(later.epochMilliseconds);
    const option = (value: typeof earlier, label: string) => ({ epochMilliseconds: value.epochMilliseconds, offset: value.offset, label });
    if (earlier.epochMilliseconds === later.epochMilliseconds) return { kind: "exact" as const, choices: [option(earlier, `${args.time} (UTC${earlier.offset})`)] };
    return { kind: "ambiguous" as const, choices: args.choice ? [args.choice === "earlier" ? option(earlier, `First occurrence (UTC${earlier.offset})`) : option(later, `Second occurrence (UTC${later.offset})`)] : [option(earlier, `First occurrence (UTC${earlier.offset})`), option(later, `Second occurrence (UTC${later.offset})`)] };
  },
});
