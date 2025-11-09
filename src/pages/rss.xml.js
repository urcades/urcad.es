import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";

const parser = new MarkdownIt();

/**
 * Generates RSS feed for published writing (excludes drafts)
 * @param {import('astro').APIContext} context - Astro API context
 * @returns {Promise<Response>} RSS feed response
 */
export async function GET(context) {
  try {
    // Only fetch published writing, explicitly excluding drafts
    const blog = await getCollection("writing");
    
    return rss({
      title: "É. Urcades",
      description: "Ongoing Writing",
      site: context.site,
      items: blog.map((post) => {
        try {
          // Safely render markdown with error handling
          const renderedContent = post.body ? parser.render(post.body) : "";
          const sanitizedContent = sanitizeHtml(renderedContent, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
          });
          
          return {
            title: post.data.title,
            pubDate: post.data.pubDate,
            description: post.data.description,
            customData: post.data.customData,
            content: sanitizedContent,
            link: `/writing/${post.id}/`,
          };
        } catch (error) {
          console.error(`Error processing post ${post.id}:`, error);
          // Return minimal RSS item on error
          return {
            title: post.data.title || "Untitled",
            pubDate: post.data.pubDate,
            description: post.data.description || "",
            link: `/writing/${post.id}/`,
          };
        }
      }),
    });
  } catch (error) {
    console.error("Error generating RSS feed:", error);
    // Return empty RSS feed on catastrophic failure
    return rss({
      title: "É. Urcades",
      description: "Ongoing Writing",
      site: context.site,
      items: [],
    });
  }
}
