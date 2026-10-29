import { protectedRegionAt } from './context.ts';

/**
 * Whether a `:shortcode` may be completed at the end of `before` (the document
 * up to the colon). Not inside code, math, links, URLs, HTML or Templater.
 * Frontmatter values are fine, because an emoji is a valid plain YAML value,
 * but frontmatter keys and the `---` lines are not.
 */
export function mayComplete(before: string): boolean {
  const region = protectedRegionAt(before);
  if (region === null) return true;
  if (region !== 'frontmatter') return false;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  return /^\s*[^:#\s][^:]*:\s+\S*$/.test(line) || /^\s*-\s+\S*$/.test(line);
}
