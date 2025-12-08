// Import utilities from `astro:content`
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Shared schema for both writing and drafts collections
const postSchema = z.object({
  title: z.string(),
  pubDate: z.date(),
  description: z.string(),
  foregroundColor: z.string().optional(),
  foregroundColorDark: z.string().optional(),
  backgroundColor: z.string().optional(),
  backgroundColorDark: z.string().optional(),
  // New fields for SMS-published stream posts
  tags: z.array(z.string()).optional(),
  media: z.array(z.object({
    url: z.string(),
    type: z.enum(['image', 'video']),
    alt: z.string().optional(),
  })).optional(),
  source: z.enum(['sms', 'web', 'cli', 'telegram']).optional(),
});

// Define a `type` and `schema` for each collection
const writingCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/writing' }),
  schema: postSchema,
});

const draftsCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/drafts' }),
  schema: postSchema,
});

// Schema for work/portfolio items
const workSchema = z.object({
  title: z.string(),
  pubDate: z.date(),
  imageUrl: z.string(),
  category: z.string(),
  tags: z.array(z.string()).optional(),
  url: z.string().optional(),
  size: z.enum(['1', '2', '3']).default('1'),
  // For future case study content - the markdown body will be used
});

const workCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/work' }),
  schema: workSchema,
});

// Export a single `collections` object to register your collection(s)
export const collections = {
  writing: writingCollection,
  drafts: draftsCollection,
  work: workCollection,
};
