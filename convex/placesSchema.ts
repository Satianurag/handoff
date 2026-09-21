import { defineTable } from "convex/server";
import { v } from "convex/values";

export const placeKind = v.union(v.literal("clinic"), v.literal("hospital"), v.literal("pharmacy"), v.literal("home"), v.literal("other"));
export const placeFields = {
  name: v.string(), kind: placeKind, address: v.string(), latitude: v.union(v.number(), v.null()), longitude: v.union(v.number(), v.null()),
  phone: v.string(), entrance: v.string(), parking: v.string(), accessibility: v.string(),
  visibility: v.union(v.literal("household"), v.literal("selected")), readerIds: v.array(v.id("users")),
};
export const geocodeCandidate = v.object({ name: v.string(), address: v.string(), latitude: v.number(), longitude: v.number() });
export const placesTables = {
  places: defineTable({ householdId: v.id("households"), ...placeFields, createdBy: v.id("users"), updatedAt: v.number(), version: v.number(), confirmedAt: v.number() }).index("by_householdId", ["householdId"]),
  visitPlaces: defineTable({ householdId: v.id("households"), visitId: v.id("visits"), placeId: v.id("places"), linkedBy: v.id("users"), updatedAt: v.number() }).index("by_visitId", ["visitId"]).index("by_householdId", ["householdId"]).index("by_placeId", ["placeId"]),
  geocodeCache: defineTable({ key: v.string(), results: v.array(geocodeCandidate), expiresAt: v.number() }).index("by_key", ["key"]).index("by_expiresAt", ["expiresAt"]),
};
