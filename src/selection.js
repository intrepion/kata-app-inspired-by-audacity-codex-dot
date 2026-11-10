/** A partially typed number must not move the opposite selection boundary. */
export function selectionInput(raw, edge, start, end, length, commit = false) {
  if (!['start','end'].includes(edge)) throw new TypeError('Unknown selection edge');
  const original = edge === 'start' ? start : end;
  if (raw.trim() === '' || !Number.isFinite(Number(raw))) return commit ? original : null;
  const value = Number(raw), low = edge === 'start' ? 0 : start, high = edge === 'start' ? end : length;
  return commit ? Math.min(high, Math.max(low, value)) : value >= low && value <= high ? value : null;
}
