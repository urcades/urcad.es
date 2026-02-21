/**
 * Shared logic for writing API endpoints (JSON API, JSON Feed).
 */

import type { CollectionEntry } from "astro:content";
import { getCollection } from "astro:content";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const parser = new MarkdownIt();

/**
 * Returns filtered, sorted writing posts.
 * Stream posts only appear after their pub date day has passed.
 */
export async function getFilteredWriting(): Promise<
  CollectionEntry<"writing">[]
> {
  const posts = await getCollection("writing");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filtered = posts.filter((post) => {
    const isStreamPost = post.data.tags?.includes("stream");
    if (isStreamPost) {
      return new Date(post.data.pubDate) < today;
    }
    return true;
  });

  return filtered.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
  );
}

/**
 * Renders markdown to sanitized HTML for feed consumption.
 */
export function renderPostContent(body: string): string {
  if (!body) return "";
  try {
    const rendered = parser.render(body);
    return sanitizeHtml(rendered, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    });
  } catch {
    return "";
  }
}
