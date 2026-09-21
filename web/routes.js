export function isAppRoute(path) {
  return /^\/(?:sign-in|start|households|account|visit-packs\/shared|records\/shared|privacy|consumer-health-privacy|terms|help|demo(?:\/join)?|privacy-requests(?:\/[a-z0-9]+)?|join\/[A-Za-z0-9_-]+)\/?$/.test(path) || /^\/h\/[a-z0-9]+\/(?:my-responsibilities|today|plan(?:\/recurring)?|visits|inbox(?:\/[a-z0-9]+)?|records(?:\/[a-z0-9]+)?|care|places|history|people(?:\/[a-z0-9]+)?|settings|review|notifications|visits\/[a-z0-9]+\/prepare|(?:tasks|coverage|visits|handovers|recurring|series|sources|drafts|sends|questions)\/[a-z0-9]+)\/?$/.test(path);
}
