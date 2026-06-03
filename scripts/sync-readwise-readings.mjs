#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputPath = path.join(repoRoot, "src/data/readings.json");
const readwiseExportUrl = "https://readwise.io/api/v2/export/";
const allowedSources = new Set(["kindle", "ibooks"]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    outputPath: defaultOutputPath,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--output") {
      const value = argv[i + 1];
      if (!value) throw new Error("--output requires a path");
      args.outputPath = path.resolve(value);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return `Usage: node scripts/sync-readwise-readings.mjs [--dry-run] [--output <path>]

Environment:
  READWISE_ACCESS_TOKEN  Required Readwise API token`;
}

async function fetchReadwiseExport(token, { fetchImpl = fetch } = {}) {
  const records = [];
  let cursor = null;

  do {
    const url = new URL(readwiseExportUrl);
    if (cursor) url.searchParams.set("pageCursor", cursor);

    const response = await fetchWithRetry(url, {
      fetchImpl,
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Readwise export failed with HTTP ${response.status}`);
    }

    const page = await response.json();
    if (!Array.isArray(page.results)) {
      throw new Error("Readwise export returned an invalid results payload");
    }

    records.push(...page.results);
    cursor = page.nextPageCursor ?? null;
  } while (cursor);

  return records;
}

async function fetchWithRetry(url, { fetchImpl, headers }) {
  let lastResponse = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(url, { headers });
    if (response.status !== 429 && response.status < 500) {
      return response;
    }

    lastResponse = response;
    const retryAfter = Number(response.headers?.get?.("retry-after"));
    const delayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return lastResponse;
}

async function readExistingLibrary(outputPath) {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { exported_at: null, books: [] };
    throw error;
  }
}

function transformReadwiseRecords(records, existingLibrary = { books: [] }, now = new Date()) {
  const existingBooks = Array.isArray(existingLibrary.books)
    ? existingLibrary.books
    : [];
  const existingIndex = buildExistingIndex(existingBooks);
  const booksById = new Map();

  for (const record of records) {
    if (!isIncludedBook(record)) continue;

    const matchedBook = findExistingBook(record, existingIndex);
    const bookId = matchedBook?.id ?? generateBookId(record.title, record.author);
    const normalizedBook = booksById.get(bookId) ?? {
      id: bookId,
      title: normalizeTitle(record.title),
      author: normalizeAuthor(record.author),
      sources: [],
      highlights: [],
      finished: matchedBook?.finished ?? null,
      finished_at: matchedBook?.finished_at ?? null,
    };

    const source = mapSource(record.source);
    if (!normalizedBook.sources.includes(source)) {
      normalizedBook.sources.push(source);
    }

    const existingHighlights = matchedBook
      ? buildHighlightTextIndex(matchedBook.highlights ?? [])
      : new Map();
    const currentHighlightTexts = new Set(
      normalizedBook.highlights.map((highlight) => normalizeText(highlight.text)),
    );

    for (const highlight of record.highlights ?? []) {
      if (!isIncludedHighlight(highlight)) continue;

      const text = normalizeHighlightText(highlight.text);
      const normalizedText = normalizeText(text);
      if (currentHighlightTexts.has(normalizedText)) continue;

      const existingHighlight = existingHighlights.get(normalizedText);
      normalizedBook.highlights.push({
        id: existingHighlight?.id ?? readwiseHighlightId(highlight, record),
        text,
        note: normalizeOptionalString(highlight.note),
        location: {
          chapter: normalizeOptionalString(highlight.chapter),
          position: readwisePosition(highlight),
        },
        created_at: readwiseCreatedAt(highlight),
        source,
      });
      currentHighlightTexts.add(normalizedText);
    }

    booksById.set(bookId, normalizedBook);
  }

  const books = [...booksById.values()]
    .filter((book) => book.highlights.length > 0)
    .map((book) => ({
      ...book,
      sources: book.sources.sort(),
      highlights: sortHighlights(book.highlights),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "en"));

  return {
    exported_at: now.toISOString(),
    books,
  };
}

function buildExistingIndex(existingBooks) {
  const byGeneratedId = new Map();
  const byTitleAuthor = new Map();
  const byHighlightText = new Map();

  for (const book of existingBooks) {
    const generatedId = generateBookId(book.title, book.author);
    byGeneratedId.set(generatedId, book);
    byTitleAuthor.set(bookKey(book.title, book.author), book);

    for (const highlight of book.highlights ?? []) {
      const normalizedText = normalizeText(highlight.text);
      if (!normalizedText) continue;
      const books = byHighlightText.get(normalizedText) ?? [];
      books.push(book);
      byHighlightText.set(normalizedText, books);
    }
  }

  return { byGeneratedId, byTitleAuthor, byHighlightText };
}

function findExistingBook(record, existingIndex) {
  const generatedId = generateBookId(record.title, record.author);
  const directMatch =
    existingIndex.byGeneratedId.get(generatedId) ??
    existingIndex.byTitleAuthor.get(bookKey(record.title, record.author));
  if (directMatch) return directMatch;

  const scores = new Map();
  for (const highlight of record.highlights ?? []) {
    const normalizedText = normalizeText(highlight.text);
    for (const book of existingIndex.byHighlightText.get(normalizedText) ?? []) {
      scores.set(book, (scores.get(book) ?? 0) + 1);
    }
  }

  let bestBook = null;
  let bestScore = 0;
  for (const [book, score] of scores) {
    if (score > bestScore) {
      bestBook = book;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestBook : null;
}

function buildHighlightTextIndex(highlights) {
  const index = new Map();
  for (const highlight of highlights) {
    const normalizedText = normalizeText(highlight.text);
    if (normalizedText && !index.has(normalizedText)) {
      index.set(normalizedText, highlight);
    }
  }
  return index;
}

function isIncludedBook(record) {
  return (
    record &&
    record.category === "books" &&
    allowedSources.has(record.source) &&
    record.is_deleted !== true &&
    Array.isArray(record.highlights)
  );
}

function isIncludedHighlight(highlight) {
  return (
    highlight &&
    highlight.is_deleted !== true &&
    typeof highlight.text === "string" &&
    normalizeText(highlight.text).length > 0
  );
}

function mapSource(source) {
  if (source === "ibooks") return "apple_books";
  return source;
}

function normalizeTitle(title) {
  const value = normalizeOptionalString(title);
  return value || "Untitled";
}

function normalizeAuthor(author) {
  return normalizeOptionalString(author);
}

function normalizeHighlightText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(text) {
  return normalizeHighlightText(text).toLowerCase();
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const string = String(value).replace(/\s+/g, " ").trim();
  return string.length > 0 ? string : null;
}

function bookKey(title, author) {
  return `${normalizeText(title)}\0${normalizeText(author)}`;
}

function generateBookId(title, author) {
  const normalizedTitle = String(title ?? "").trim().toLowerCase();
  const normalizedAuthor = String(author ?? "").trim().toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`${normalizedTitle}${normalizedAuthor}`)
    .digest("hex")
    .slice(0, 16);
}

function readwiseHighlightId(highlight, record) {
  if (highlight.id !== null && highlight.id !== undefined) {
    return `readwise-${highlight.id}`;
  }

  return `readwise-${crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        book: generateBookId(record.title, record.author),
        text: normalizeHighlightText(highlight.text),
        location: highlight.location ?? null,
        source: record.source ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 16)}`;
}

function readwisePosition(highlight) {
  const location = normalizeOptionalString(highlight.location);
  const locationType = normalizeOptionalString(highlight.location_type);
  if (!location) return null;
  return locationType ? `${locationType}: ${location}` : location;
}

function readwiseCreatedAt(highlight) {
  const value =
    normalizeOptionalString(highlight.highlighted_at) ??
    normalizeOptionalString(highlight.created_at);
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function sortHighlights(highlights) {
  return [...highlights].sort((a, b) => {
    if (a.created_at && b.created_at) return a.created_at.localeCompare(b.created_at);
    if (a.created_at) return -1;
    if (b.created_at) return 1;
    return a.text.localeCompare(b.text, "en");
  });
}

function validateLibrary(library) {
  if (!library || typeof library.exported_at !== "string" || !Array.isArray(library.books)) {
    throw new Error("Generated library has an invalid top-level shape");
  }

  const bookIds = new Set();
  const highlightIds = new Set();
  for (const book of library.books) {
    for (const key of ["id", "title", "sources", "highlights"]) {
      if (!(key in book)) throw new Error(`Generated book is missing ${key}`);
    }
    if (bookIds.has(book.id)) throw new Error(`Duplicate book id: ${book.id}`);
    bookIds.add(book.id);

    for (const highlight of book.highlights) {
      if (!highlight.id || !highlight.text || !highlight.location || !highlight.source) {
        throw new Error(`Generated highlight has an invalid shape in book ${book.id}`);
      }
      if (highlightIds.has(highlight.id)) {
        throw new Error(`Duplicate highlight id: ${highlight.id}`);
      }
      highlightIds.add(highlight.id);
    }
  }

  return library;
}

function summarize(library, readwiseRecordCount) {
  const sourceCounts = new Map();
  let highlightCount = 0;
  for (const book of library.books) {
    highlightCount += book.highlights.length;
    for (const source of book.sources) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }

  return {
    readwise_records: readwiseRecordCount,
    books: library.books.length,
    highlights: highlightCount,
    sources: Object.fromEntries([...sourceCounts.entries()].sort()),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const token = process.env.READWISE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("READWISE_ACCESS_TOKEN is required");
  }

  const existingLibrary = await readExistingLibrary(args.outputPath);
  const records = await fetchReadwiseExport(token);
  const library = validateLibrary(transformReadwiseRecords(records, existingLibrary));
  const summary = summarize(library, records.length);

  if (args.dryRun) {
    console.log(JSON.stringify({ dry_run: true, ...summary }, null, 2));
    return;
  }

  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.outputPath, `${JSON.stringify(library, null, 2)}\n`);
  console.log(JSON.stringify({ output: args.outputPath, ...summary }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export {
  generateBookId,
  mapSource,
  summarize,
  transformReadwiseRecords,
  validateLibrary,
};
