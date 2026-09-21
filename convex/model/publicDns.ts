"use node";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { publicUrl } from "./publicUrl";

// Imported only by Node actions. Never fetch the target from our own backend.
export async function validatePublicDns(input: string) {
  const url = publicUrl(input);
  const records = await lookup(new URL(url).hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => ipaddr.process(record.address).range() !== "unicast")) throw new Error("PUBLIC_URL_REQUIRED");
  return url;
}
