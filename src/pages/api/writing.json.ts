import type { APIRoute } from "astro";
import { getFilteredWriting } from "../../lib/writing-api";

/**
 * JSON API endpoint returning all published writing with metadata.
 * GET /api/writing
 */
export const GET: APIRoute = async () => {
  try {
    const posts = await getFilteredWriting();

    const postsData = posts.map((post) => ({
      id: post.id,
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate.toISOString(),
      url: `/writing/${post.id}/`,
      tags: post.data.tags || [],
    }));

    return new Response(JSON.stringify(postsData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error generating writing JSON:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch writing" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
};
