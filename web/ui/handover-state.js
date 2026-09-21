// Draft text belongs to the writer; acceptance choices belong to one reviewed snapshot.
export function handoverUpdatePolicy(previous, next, { dirty = false, submitting = false } = {}) {
  if (!previous || submitting) return 'render';
  if (previous.handover.status === 'draft' && next.handover.status === 'draft' && dirty) return 'preserve-draft';
  if (previous.handover.status === 'pending' && next.handover.status === 'pending') {
    if (previous.handover.version !== next.handover.version || previous.stale !== next.stale) return 'reset-acceptance';
    return 'preserve-acceptance';
  }
  return 'render';
}
