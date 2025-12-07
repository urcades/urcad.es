# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal website and blog for Édouard Urcades (urcad.es), built with Astro and deployed on Vercel. The site features a minimalist design philosophy with blog posts, portfolio work samples, and custom interactive components.

## Development Commands

```bash
# Start development server
npm run dev
# or
npm start

# Build for production (includes type checking)
npm run build

# Preview production build
npm run preview

# Run Astro CLI directly
npm run astro
```

The build command runs `astro check` for TypeScript validation before building.

## Architecture

### Content Collections

The site uses Astro's Content Collections API with two collections:

- **`writing`**: Published blog posts in `src/content/writing/`
- **`drafts`**: Draft posts in `src/content/drafts/` (visible only in dev mode)

Both collections share the same schema defined in `src/content.config.ts`:
- `title`: string
- `pubDate`: date
- `description`: string
- `foregroundColor`, `foregroundColorDark`: optional custom text colors
- `backgroundColor`, `backgroundColorDark`: optional custom background colors

Content is loaded using Astro's glob loader pattern, excluding files prefixed with underscore.

Additional schema fields for stream posts (added for Telegram publishing):
- `tags`: optional array of strings (e.g., `["stream"]`)
- `media`: optional array of media objects with `url`, `type` ('image'|'video'), and optional `alt`
- `source`: optional enum ('sms', 'web', 'cli', 'telegram') indicating how the post was created

### Layout System

**Base Layout** (`src/layouts/Base.astro`):
- Core HTML structure and meta tags
- Accepts custom colors via props for per-page theming
- Uses modern CSS features: `light-dark()` function for color scheme support with fallbacks
- Global typography defaults (Times New Roman base)
- Responsive breakpoints: 555px, 768px, 1000px, 2222px

**Writing Layout** (`src/layouts/Writing.astro`):
- Wraps Base layout with blog-specific styling
- Max-width content constraint (55ch)
- Custom blockquote, image, and code block styling
- Displays metadata footer with title, description, pub date

### Pages

**Dynamic Routes**:
- `/writing/[id].astro`: Published blog posts
- `/drafts/[id].astro`: Draft posts (dev only)

**Static Pages**:
- `index.astro`: Homepage
- `writing.astro`: Chronological blog index grouped by year, includes drafts in dev mode
- `work.astro`: Portfolio grid showcasing recent work using the Sketch component
- `about.astro`: About page
- `404.astro`: Custom 404 page with interactive wind sound synthesizer (Web Audio API)

**RSS Feed** (`rss.xml.js`):
- Generates RSS feed for published writing only (excludes drafts)
- Uses markdown-it for rendering and sanitize-html for security
- Error handling for individual posts and catastrophic failures

### Components

**Sketch** (`src/components/Sketch.astro`):
- Portfolio item component for displaying work samples
- Props: `imageUrl`, `title`, `category`, `url` (optional), `size` (1-3)
- Responsive grid system using container queries with media query fallbacks
- Size variants: 1 (default), 2 (larger), 3 (full-width)
- Breakpoint-aware width calculations

### Styling Approach

- No CSS preprocessors or frameworks
- Scoped and global styles directly in Astro components
- Progressive enhancement with feature detection (`@supports`)
- Modern CSS with fallbacks: `light-dark()`, container queries, `:has()` selector
- Dark mode via `prefers-color-scheme` and `color-scheme` property
- Custom properties for theming at page level

### Assets

`src/assets/` contains images organized by date-based directories (format: YYMMDD) referenced in blog posts using relative paths.

### Telegram Blog Publisher (`workers/sms-publisher/`)

A Cloudflare Worker that enables publishing blog posts via Telegram messages. Located in `workers/sms-publisher/`.

**Architecture**:
```
Telegram App → Bot → Cloudflare Worker → GitHub API → Auto-deploy
                            ↓
                     Cloudflare R2 (media storage)
```

**How it works**:
1. User sends a message (text, photo, or video) to the Telegram bot
2. Worker receives the webhook, validates user against whitelist
3. Media files are uploaded to R2 bucket (`urcades`) under `stream/YYMMDD/` path
4. Content is committed to GitHub via API, creating/updating daily digest posts
5. Site auto-deploys via existing Vercel workflow

**Daily Digest Format**:
- Posts are aggregated into daily files named `YYMMDD.md` (e.g., `251205.md`)
- Each message entry includes timestamp (e.g., "7:13 AM") and content
- Multiple entries in a day are separated by `~` on its own line
- Frontmatter includes `tags: ["stream"]` and `source: "telegram"`
- Media URLs point to `https://media.urcad.es/stream/YYMMDD/filename`

**Worker Configuration** (`workers/sms-publisher/wrangler.toml`):
- R2 bucket binding: `MEDIA_BUCKET` → `urcades`
- Required secrets: `GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`, `WHITELISTED_USERS`
- Environment variable: `GITHUB_REPO`

**Key Files**:
- `workers/sms-publisher/src/index.ts`: Main worker logic
- `workers/sms-publisher/SETUP.md`: Detailed setup instructions
- `workers/sms-publisher/wrangler.toml`: Cloudflare configuration

**Access Control**:
- Whitelisted Telegram user IDs → posts go to `src/content/writing/`
- Non-whitelisted users → posts go to `src/content/drafts/`

**Worker Commands**:
```bash
cd workers/sms-publisher
npm install
npm run dev      # Local development
npm run deploy   # Deploy to Cloudflare
npm run tail     # View logs
```

## TypeScript Configuration

Uses Astro's strict TypeScript config: `"extends": "astro/tsconfigs/strict"`

## Deployment

The site auto-deploys to Vercel on push to main branch via GitHub Actions workflow (`.github/workflows/publish.yml`). The workflow:
1. Checks out code
2. Sets up Node.js 23
3. Installs dependencies
4. Runs build (which includes type checking)

Site URL: https://www.urcad.es

## Configuration Notes

- Syntax highlighting is disabled (`syntaxHighlight: false` in astro.config.mjs)
- Prefetch is enabled for all internal links (`prefetchAll: true`)
- Custom font preloading: `/diatype.ttf`

## Content Guidelines

When adding new blog posts:
1. Create markdown file in `src/content/writing/` (published) or `src/content/drafts/` (draft)
2. Include required frontmatter: title, pubDate, description
3. Optional frontmatter for custom colors: foregroundColor, backgroundColor, and their dark mode variants
4. Images should be placed in `src/assets/` in date-based subdirectories
5. Reference images using relative paths: `../../assets/YYMMDD/image.jpg`
