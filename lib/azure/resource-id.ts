/** Display parts of an ARM resource ID: last name and its full type. */
export function describeResourceId(resourceId: string): { name: string; type: string } {
  const parts = resourceId.split('/').filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase() === 'providers');
  if (i < 0) return { name: parts.at(-1) ?? resourceId, type: '' };
  const after = parts.slice(i + 1);
  // after = [namespace, type, name, (childType, childName)...]
  const namespace = after[0] ?? '';
  const types = after.slice(1).filter((_, j) => j % 2 === 0);
  return { name: after.at(-1) ?? resourceId, type: [namespace, ...types].join('/') };
}
