import { spawnSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const convexCli = resolve(root, "node_modules/convex/bin/main.js");
const staticHostingCli = resolve(
  root,
  "node_modules/@convex-dev/static-hosting/dist/cli/index.js",
);
const previewName = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const seedPreviewEnvironmentOnly = process.argv.includes("--seed-preview-env");
const demoLimitSettings = [
  { key: "demoActiveLimit", numericValue: 100 },
  { key: "demoDailyLimit", numericValue: 400 },
];

if (!previewName || !/^pr-(?:\d+|smoke|fresh-[a-z0-9-]+)$/.test(previewName)) {
  throw new Error("Usage: node scripts/deploy-preview.mjs pr-<number>|pr-smoke|pr-fresh-<suffix> [--dry-run]");
}

function deploymentUrlsFromOutput(output) {
  const match = output.match(/https:\/\/[a-z0-9-]+\.convex\.cloud\b/i);
  if (!match) {
    throw new Error("Convex deploy output did not include a preview cloud URL.");
  }
  const cloudUrl = match[0];
  return {
    cloudUrl,
    siteUrl: cloudUrl.replace(/\.convex\.cloud$/i, ".convex.site"),
  };
}

function jsonFromOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Convex component did not return deployment URLs.");
  }
  return JSON.parse(output.slice(start, end + 1));
}

function runConvex(args, { input, quiet = false, includeStderr = false } = {}) {
  const result = spawnSync(process.execPath, [convexCli, ...args], {
    cwd: root,
    env: process.env,
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Could not start Convex CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (!quiet) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`Convex CLI ${args[0]} failed (exit ${result.status}).`);
  }
  if (includeStderr) {
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }
  return result.stdout ?? "";
}

function operatorConfigureArgs({ key, numericValue }) {
  return [
    "run",
    "--preview-name",
    previewName,
    "operator:configure",
    JSON.stringify({ key, enabled: true, numericValue }),
    "--typecheck=disable",
    "--codegen=disable",
  ];
}

function runProcess(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Could not start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed (exit ${result.status}).`);
  }
}

function setPreviewEnv(name, value) {
  const result = spawnSync(
    process.execPath,
    [
      convexCli,
      "env",
      "set",
      "--preview-name",
      previewName,
      "--force",
      name,
    ],
    {
      cwd: root,
      env: process.env,
      input: value,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not set preview environment variable ${name} (exit ${result.status}). Output withheld.`,
    );
  }
  console.log(`Set preview environment variable ${name}.`);
}

function seedEnvironment() {
  const environment = {
    FIRECRAWL_API_KEY: "preview-disabled",
    AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY || "preview-disabled",
  };
  if (process.env.GEMINI_API_KEY) {
    environment.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  }
  return environment;
}

if (seedPreviewEnvironmentOnly) {
  if (!process.env.CONVEX_DEPLOY_KEY) {
    throw new Error("CONVEX_DEPLOY_KEY must contain a Convex preview deploy key.");
  }
  for (const [name, value] of Object.entries(seedEnvironment())) {
    setPreviewEnv(name, value);
  }
  process.exit(0);
}

function checkDeploymentUrls(componentUrls, deployedUrls) {
  const cloudUrl = new URL(componentUrls.cloudUrl);
  const siteUrl = new URL(componentUrls.siteUrl);
  if (
    cloudUrl.protocol !== "https:" ||
    !cloudUrl.hostname.endsWith(".convex.cloud") ||
    siteUrl.protocol !== "https:" ||
    !siteUrl.hostname.endsWith(".convex.site") ||
    componentUrls.cloudUrl !== deployedUrls.cloudUrl ||
    siteUrl.origin !== deployedUrls.siteUrl
  ) {
    throw new Error("Preview URL resolution did not match the deployment output.");
  }
  return { cloudUrl: componentUrls.cloudUrl, siteUrl: siteUrl.origin };
}

if (dryRun) {
  const deployedUrls = deploymentUrlsFromOutput(
    "Deploying code to deployment: https://generated-preview-123.convex.cloud",
  );
  const resolved = checkDeploymentUrls(
    {
      cloudUrl: deployedUrls.cloudUrl,
      siteUrl: deployedUrls.siteUrl,
    },
    deployedUrls,
  );
  console.log(
    JSON.stringify(
      {
        previewName,
        backendDeploy: [
          "deploy",
          "--preview-name",
          previewName,
          "--typecheck",
          "enable",
          "--codegen",
          "disable",
          "--cmd",
          `node scripts/deploy-preview.mjs ${previewName} --seed-preview-env`,
        ],
        urlLookup: [
          "run",
          "--preview-name",
          previewName,
          "--component",
          "staticHosting",
          "lib:getUrls",
          "{}",
        ],
        resolvedSiteUrl: resolved.siteUrl,
        urlResolution: "Derived from Convex deployment output, not the preview name.",
        demoLimits: demoLimitSettings.map(setting => ({
          ...setting,
          enabled: true,
          args: operatorConfigureArgs(setting),
        })),
        environmentVariables: [
          "SITE_URL",
          "JWT_PRIVATE_KEY",
          "JWKS",
          "FIRECRAWL_API_KEY",
          "AGENTMAIL_API_KEY",
          "GENERATION_PROVIDER",
          "GEMINI_MODEL",
          "GEMINI_API_KEY",
          "GOOGLE_CLOUD_LOCATION",
        ],
        build: ["npm", "run", "build:web", "with CONVEX_URL from the preview"],
        upload: [
          "static-hosting",
          "upload",
          "--dist",
          "./dist",
          "--component",
          "staticHosting",
          "with --preview-name injected into each Convex run",
        ],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!process.env.CONVEX_DEPLOY_KEY) {
  throw new Error("CONVEX_DEPLOY_KEY must contain a Convex preview deploy key.");
}

const deployOutput = runConvex([
  "deploy",
  "--preview-name",
  previewName,
  "--typecheck",
  "enable",
  "--codegen",
  "disable",
  "--cmd",
  `node scripts/deploy-preview.mjs ${previewName} --seed-preview-env`,
], { includeStderr: true });
process.stdout.write(deployOutput);

const deployedUrls = deploymentUrlsFromOutput(deployOutput);
for (const setting of demoLimitSettings) {
  runConvex(operatorConfigureArgs(setting));
}

const componentUrls = jsonFromOutput(
  runConvex([
    "run",
    "--preview-name",
    previewName,
    "--component",
    "staticHosting",
    "lib:getUrls",
    "{}",
    "--typecheck=disable",
    "--codegen=disable",
  ]),
);
const { cloudUrl, siteUrl } = checkDeploymentUrls(
  componentUrls,
  deployedUrls,
);

const { privateKey, publicKey } = await generateKeyPair("RS256", {
  extractable: true,
});
const jwtPrivateKey = await exportPKCS8(privateKey);
const jwks = JSON.stringify({
  keys: [{ use: "sig", ...(await exportJWK(publicKey)) }],
});

const previewEnvironment = {
  SITE_URL: siteUrl,
  JWT_PRIVATE_KEY: jwtPrivateKey,
  JWKS: jwks,
  GENERATION_PROVIDER: "gemini",
  GEMINI_MODEL: "gemini-3.8-flash",
  GOOGLE_CLOUD_LOCATION: "global",
};
if (process.env.GOOGLE_CLOUD_PROJECT) {
  previewEnvironment.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
}

for (const [name, value] of Object.entries(previewEnvironment)) {
  setPreviewEnv(name, value);
}

runProcess("npm", ["run", "build:web"], {
  ...process.env,
  CONVEX_URL: cloudUrl,
});

const previewShim = resolve(root, "scripts/convex-preview-name.cjs");
const nodeOptions = [
  process.env.NODE_OPTIONS,
  `--require=${previewShim}`,
]
  .filter(Boolean)
  .join(" ");
runProcess(
  process.execPath,
  [
    staticHostingCli,
    "upload",
    "--dist",
    resolve(root, "dist"),
    "--component",
    "staticHosting",
  ],
  {
    ...process.env,
    CONVEX_URL: cloudUrl,
    HANDOFF_PREVIEW_NAME: previewName,
    NODE_OPTIONS: nodeOptions,
  },
);

const previewEnvironmentName = `preview-${previewName}`;
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `preview_url=${siteUrl}\npreview_name=${previewEnvironmentName}\n`,
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## Convex preview\n\n[${siteUrl}](${siteUrl})\n`,
  );
}
console.log(`Preview site: ${siteUrl}`);
