const INTERACTION_PATTERN = /(^|[_-])(interact|special)([_-]|$)/i;
const FALLBACK_PATTERN = /(^|[_-])(touch|tap|click)([_-]|$)/i;

export function interactionAnimations(names) {
  const primary = names.filter((name) => INTERACTION_PATTERN.test(name));
  return primary.length ? primary : names.filter((name) => FALLBACK_PATTERN.test(name));
}

export function randomInteractionAnimation(names, random = Math.random) {
  if (!names.length) return null;
  const index = Math.min(names.length - 1, Math.floor(random() * names.length));
  return names[index];
}
