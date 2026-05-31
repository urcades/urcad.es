# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a personal website and blog for Édouard Urcades (urcad.es), built with Astro and served as a Cloudflare Worker. The site features a minimalist design philosophy with blog posts, portfolio work samples, and custom interactive components. A unified Worker handles static asset delivery and Overland location tracking; local publishing is handled by deterministic repo scripts that can be called by Apple Messages, email, or other private capture bridges.

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

# Local stream publishing
npm run publish:stream -- --event /path/to/event.json
npm run publish:stream:run -- --event /path/to/event.json --result-json /path/to/result.json
npm run test:publish-stream

# Worker commands (Cloudflare)
npm run worker:dev      # Local Worker dev (serves dist/ + API routes)
npm run worker:deploy    # Deploy Worker only (no build)
npm run deploy          # Build + deploy Worker
npm run worker:tail     # Stream Worker logs
```

The build command runs `astro check` for TypeScript validation before building.

## Architecture

### Content Collections

The site uses Astro's Content Collections API with three collections:

- **`writing`**: Published blog posts in `src/content/writing/`
- **`drafts`**: Draft posts in `src/content/drafts/` (visible only in dev mode)
- **`work`**: Portfolio items in `src/content/work/`

Writing and drafts share the same post schema defined in `src/content.config.ts`:
- `title`: string
- `pubDate`: date
- `description`: string
- `foregroundColor`, `foregroundColorDark`: optional custom text colors
- `backgroundColor`, `backgroundColorDark`: optional custom background colors

Content is loaded using Astro's glob loader pattern, excluding files prefixed with underscore.

Additional schema fields for stream posts:
- `tags`: optional array of strings (e.g., `["stream"]`)
- `media`: optional array of media objects with `url`, `type` ('image'|'video'), and optional `alt`
- `source`: optional enum ('sms', 'web', 'cli', 'telegram', 'imessage', 'email') indicating how the post was created. `telegram` remains valid historical provenance for old content, not an active publishing path.

Work collection schema: `title`, `pubDate`, `imageUrl`, `category`, `tags`, `url`, `size` (1–3)

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
- `/work/[id].astro`: Portfolio item detail pages

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

### Unified Cloudflare Worker (`worker/`)

The site is served by a single Cloudflare Worker that handles static assets and API routes. Configuration is in `wrangler.toml` at the repo root.

**Architecture**:
```
Request → Worker (run_worker_first) → API routes or fallthrough to ASSETS (dist/)
```

**Routes**:
- `POST /api/location` — Overland iOS location receiver
- `GET /api/location/current` — Latest stored location (city, coords) — used by about page
- `*` — Static Astro site from `dist/` via `[assets]` binding

**Bindings** (`wrangler.toml`):
- `ASSETS`: Static build from `./dist`
- `LOCATION_KV`: KV namespace for latest location

**Required secrets** (set via `npx wrangler secret put <NAME>` or `scripts/set-secrets.sh`):
- `OVERLAND_TOKEN`

**Key Files**:
- `worker/src/index.ts`: Router and Env interface
- `worker/src/location.ts`: Overland receiver, KV storage, Nominatim geocoding

**Location tracking**: Overland iOS app POSTs GeoJSON to `/api/location`; Worker stores latest in KV and reverse-geocodes via Nominatim. The about page fetches `/api/location/current` to display "Currently in {city}, {country}".

### Local Stream Publisher for Host Agents

Use `npm run publish:stream:run -- --event /path/to/event.json --result-json /path/to/result.json` when a local host agent needs to author stream content from Apple Messages, email, or another private capture surface. This full-run command publishes the normalized event, fast-forwards the current branch from `origin`, runs tests/build, commits only the generated content file, pushes the current branch, deploys the already-built Worker assets, verifies the public URL, cross-posts to configured social targets, writes a machine-readable result JSON file, and prints a JSON result for humans. Use `npm run publish:stream -- --event /path/to/event.json` only for low-level debugging.

This repository owns deterministic publishing from a normalized event; the host bridge owns message watching, attachment readiness, duplicate detection, and event JSON creation.

Normalized event contract:

```json
{
  "id": "stable-message-or-bridge-id",
  "source": "imessage",
  "sender": "optional sender identifier",
  "receivedAt": "2026-05-30T12:34:56.000Z",
  "text": "🎡 body text",
  "media": [{ "path": "/absolute/path.jpg", "mimeType": "image/jpeg", "alt": "" }]
}
```

Rules for host agents:

1. Human-facing publish messages should start with `🎡`. The marker is control metadata and must not appear in the generated markdown.
2. `text` must start with `🎡`, `publish:`, or `draft:`. Missing prefixes are intentional hard failures and must not be auto-corrected into publishes.
3. `🎡` and `publish:` write/append `src/content/writing/YYMMDD.md`; `draft:` writes/appends `src/content/drafts/YYMMDD.md`.
4. `source` must be one of `imessage`, `email`, `sms`, `cli`, `web`, or `telegram`. Use `telegram` only for historical/imported provenance; it is not an active integration path.
5. Media paths must be absolute local paths and attachments must exist before invoking the publisher.
6. The host bridge must maintain its own processed-message ledger keyed by durable message and attachment IDs. Do not rely on timestamp/text matching for dedupe.
7. The host machine must have Cloudflare/Wrangler auth available for R2 uploads and deploys. Use `--dry-run` to inspect R2 keys and output paths without writing files, committing, pushing, deploying, uploading media, or cross-posting.
8. Prefer the full-run command with `--result-json`. It refuses to start with pre-existing tracked changes, fast-forwards the current branch from `origin`, commits only the generated markdown file, and deploys only published writing posts.
9. Bridge integrations should parse the result JSON file first. Stdout is intentionally human-facing and may contain npm or subprocess output before the final JSON.
10. After a deployed writing publish verifies its public URL, the wrapper attempts configured social cross-posts. Cross-post failures are non-fatal and appear under `crossposts` in the result JSON.
11. Local cross-post credentials live outside the repo at `~/Library/Application Support/urcad.es/social-crosspost.json` with owner-only permissions. This file manually mirrors Worker secrets because Wrangler secrets cannot be read back out. Never print or commit its values.
12. Local publishing is the supported authoring path. Historical `source: "telegram"` content should remain valid, but the Worker no longer exposes that legacy endpoint.

## TypeScript Configuration

Uses Astro's strict TypeScript config: `"extends": "astro/tsconfigs/strict"`

## Deployment

Deploy via `npm run deploy` (builds Astro, then deploys Worker with `wrangler deploy`). CI or manual push to main can trigger this. The Worker serves the static site and API routes.

- **Custom Domain**: `https://www.urcad.es`

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
