import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";

/**
 * Generate static paths for all posts.
 */
export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection("writing");
  return posts.map((post) => ({
    params: { id: post.id },
    props: { post },
  }));
};

/**
 * JSON API endpoint returning a single post with full content.
 * Designed for AI agents and programmatic access.
 */
export const GET: APIRoute = async ({ props }) => {
  try {
    const { post } = props;

    if (!post) {
      return new Response(JSON.stringify({ error: "Post not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    const postData = {
      id: post.id,
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate.toISOString(),
      url: `/writing/${post.id}/`,
      tags: post.data.tags || [],
      // Include the raw markdown content for AI consumption
      content: post.body || "",
    };

    return new Response(JSON.stringify(postData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error generating post JSON:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch post" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
};
