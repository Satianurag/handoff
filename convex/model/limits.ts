import { DAY, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./access";

export const limits = new RateLimiter(components.rateLimiter, {
  demoUserCreates: { kind: "token bucket", rate: 2, period: MINUTE, capacity: 2 },
  inviteCreates: { kind: "token bucket", rate: 5, period: MINUTE, capacity: 5 },
  sourceRefresh: { kind: "token bucket", rate: 1, period: MINUTE, capacity: 1 },
  otpRecipient: { kind: "token bucket", rate: 1, period: MINUTE, capacity: 1 },
  otpDailyRecipient: { kind: "fixed window", rate: 10, period: DAY },
  otpGlobal: { kind: "fixed window", rate: 100, period: DAY },
});

export async function numericSetting(ctx: MutationCtx, key: string, fallback: number, maximum = 10000) {
  const setting = await ctx.db.query("operatorSettings").withIndex("by_key", q => q.eq("key", key)).unique();
  const value = setting?.enabled && setting.numericValue !== undefined ? setting.numericValue : fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail("INVALID_OPERATOR_CONFIG", "An operational limit needs correction.");
  return value;
}

const dailyAllowances={householdSourceChecks:["dailyHouseholdSourceChecks",10],globalPageOperations:["dailyPageOperations",500],householdSends:["dailyHouseholdSends",20],globalSends:["dailyOutboundMessages",100]} as const;
export async function dailyAllowance(ctx:MutationCtx,name:keyof typeof dailyAllowances,key?:string,count=1){
 const [setting,fallback]=dailyAllowances[name];
 return limits.limit(ctx,name,{key,count,config:{kind:"fixed window",rate:await numericSetting(ctx,setting,fallback),period:DAY},throws:true});
}

// Day keys never carry allowance into another day. Re-anchor legacy randomized
// windows atomically while preserving their stored debit, including uncertainty.
export async function modelDayConfig(ctx:MutationCtx,name:string,key:string,day:string,rate:number){
 const config={kind:"fixed window" as const,rate,period:DAY,start:Date.parse(`${day}T00:00:00Z`)};
 const balance=await limits.getValue(ctx,name,{key,config});
 if(balance.ts!==0 && balance.ts!==config.start && day===new Date().toISOString().slice(0,10)){
  const used=rate-balance.value;
  await limits.reset(ctx,name,{key});
  await limits.limit(ctx,name,{key,count:used,reserve:true,config});
 }
 return config;
}
