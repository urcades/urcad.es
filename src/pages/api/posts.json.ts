import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

/**
 * JSON API endpoint returning all published posts with metadata.
 * Designed for AI agents and programmatic access.
 */
export const GET: APIRoute = async () => {
  try {
    const posts = await getCollection("writing");

    // Get start of today (midnight) for filtering stream posts
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filter posts: stream posts only appear after their day has passed
    const filteredPosts = posts.filter((post) => {
      const isStreamPost = post.data.tags?.includes("stream");
      if (isStreamPost) {
        return new Date(post.data.pubDate) < today;
      }
      return true;
    });

    // Sort by date, newest first
    const sortedPosts = filteredPosts.sort(
      (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
    );

    const postsData = sortedPosts.map((post) => ({
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
    console.error("Error generating posts JSON:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch posts" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
};
