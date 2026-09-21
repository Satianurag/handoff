import {defineTable} from "convex/server";
import {v} from "convex/values";
export const careShareTables={
 careShares:defineTable({householdId:v.id("households"),packId:v.id("visitPacks"),packVersion:v.number(),recipientEmail:v.string(),createdBy:v.id("users"),createdAt:v.number(),expiresAt:v.number(),revokedAt:v.optional(v.number())})
 .index("by_householdId",["householdId"]).index("by_packId",["packId"]),
};
