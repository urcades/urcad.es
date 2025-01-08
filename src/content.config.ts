// Import utilities from `astro:content`
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const drafts = defineCollection({});

// Define a `type` and `schema` for each collection
const writingCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.date(),
    description: z.string(),
    foregroundColor: z.string().optional(),
    foregroundColorDark: z.string().optional(),
    backgroundColor: z.string().optional(),
    backgroundColorDark: z.string().optional(),
  }),
});

// Export a single `collections` object to register your collection(s)
export const collections = {
  writing: writingCollection,
  drafts, // Potentially fix this later with a 'real' implementation of drafts
};
