const previewName = process.env.HANDOFF_PREVIEW_NAME;
const cliPath = (process.argv[1] ?? "").replaceAll("\\", "/");

if (
  previewName &&
  /^pr-(?:\d+|smoke)$/.test(previewName) &&
  cliPath.endsWith("/convex/bin/main.js") &&
  process.argv[2] === "run" &&
  !process.argv.includes("--preview-name")
) {
  process.argv.splice(3, 0, "--preview-name", previewName);
}
