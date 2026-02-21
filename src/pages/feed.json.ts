import type { APIRoute } from "astro";
import { getFilteredWriting, renderPostContent } from "../lib/writing-api";

const SITE = "https://www.urcad.es";

/**
 * JSON Feed 1.1 endpoint.
 * GET /feed.json
 */
export const GET: APIRoute = async () => {
  try {
    const posts = await getFilteredWriting();

    const feed = {
      version: "https://jsonfeed.org/version/1.1",
      title: "É. Urcades",
      home_page_url: SITE,
      feed_url: `${SITE}/feed.json`,
      description: "Ongoing Writing",
      items: posts.map((post) => {
        const url = `${SITE}/writing/${post.id}/`;
        let contentHtml = "";
        try {
          contentHtml = renderPostContent(post.body || "");
        } catch (error) {
          console.error(`Error processing post ${post.id}:`, error);
        }
        return {
          id: url,
          url,
          title: post.data.title || "Untitled",
          content_html: contentHtml || post.data.description || "",
          date_published: post.data.pubDate.toISOString(),
        };
      }),
    };

    return new Response(JSON.stringify(feed, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/feed+json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error generating JSON Feed:", error);
    return new Response(
      JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "É. Urcades",
        home_page_url: SITE,
        feed_url: `${SITE}/feed.json`,
        description: "Ongoing Writing",
        items: [],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/feed+json",
        },
      }
    );
  }
};
