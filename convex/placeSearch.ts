import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { fail, text } from "./model/access";
import { digest } from "./model/sourceText";
import { geocodeCandidate } from "./placesSchema";

type Candidate={name:string;address:string;latitude:number;longitude:number};
export const search=action({args:{householdId:v.id("households"),query:v.string()},returns:v.array(geocodeCandidate),handler:async(ctx,args):Promise<Candidate[]>=>{
  const query=text(args.query,"Public place or address",240);
  await ctx.runMutation(internal.places.authorizeSearch,{householdId:args.householdId});
  const key=digest(query.toLowerCase()),cached:Candidate[]|null=await ctx.runQuery(internal.places.cached,{key});if(cached)return cached;
  let response:Response;
  try{response=await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`,{headers:{"User-Agent":"HandoffCare/1.0 public-place-search"},signal:AbortSignal.timeout(12000)});}
  catch{return fail("MAP_SEARCH_UNAVAILABLE","Place search is unavailable. You can still enter the address and confirm a pin manually.");}
  if(!response.ok)return fail("MAP_SEARCH_UNAVAILABLE","Place search is unavailable. Try again later or enter the location manually.");
  const data:unknown=await response.json();
  const features=data&&typeof data==="object"&&"features"in data&&Array.isArray(data.features)?data.features:[];
  const result:Candidate[]=[];
  for(const feature of features.slice(0,5)){
    if(!feature||typeof feature!=="object")continue;const geometry=feature.geometry,p=feature.properties;
    if(!geometry||!Array.isArray(geometry.coordinates)||!p||typeof p!=="object")continue;
    const [longitude,latitude]=geometry.coordinates;if(typeof longitude!=="number"||typeof latitude!=="number"||!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>85.051129)continue;
    const s=(key:string)=>typeof p[key]==="string"?p[key].slice(0,300):"";
    const name=s("name")||s("street")||s("city"),address=[s("name"),[s("housenumber"),s("street")].filter(Boolean).join(" "),s("city")||s("town")||s("village"),s("state"),s("postcode"),s("country")].filter(Boolean).join(", ").slice(0,1000);
    if(name&&address)result.push({name:name.slice(0,160),address,latitude,longitude});
  }
  await ctx.runMutation(internal.places.cache,{key,results:result});return result;
}});
