import { fail } from "./access";

export function publicUrl(input: string) {
  if (input.length > 2048) fail("INVALID_URL", "Use a public page URL under 2048 characters.");
  let url: URL;
  try { url = new URL(input); } catch { return fail("INVALID_URL", "Enter a complete public HTTPS URL."); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) fail("PRIVATE_URL", "Use a public HTTP(S) page without credentials or a custom port.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|test|invalid|onion)$/.test(host) || host.startsWith("[") || /^[\d.]+$/.test(host)) fail("PRIVATE_URL", "Private networks and IP-address URLs are not supported.");
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { return fail("INVALID_URL", "The page URL contains an invalid path encoding."); }
  if (/(^|\.)(mychart|portal|patientportal|login|signin)\./.test(host) || /\/(mychart|portal|patient-portal|login|signin|account|oauth|auth)(\/|$)/i.test(decodedPath)) fail("PRIVATE_URL", "Patient portals and signed-in pages cannot be imported.");
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_(source|medium|campaign|term|content)$/i.test(key)) url.searchParams.delete(key);
    else fail("PRIVATE_URL", "Remove query parameters, personal details, and access tokens before adding this public page.");
  }
  url.hash = ""; url.hostname = host;
  return url.toString();
}
