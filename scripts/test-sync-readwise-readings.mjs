import assert from "node:assert/strict";
import test from "node:test";

import {
  generateBookId,
  transformReadwiseRecords,
  validateLibrary,
} from "./sync-readwise-readings.mjs";

const now = new Date("2026-06-03T12:00:00.000Z");

function makeRecord(overrides = {}) {
  return {
    id: 100,
    title: "The Systems Book",
    author: "Ada Lovelace",
    category: "books",
    source: "kindle",
    is_deleted: false,
    highlights: [
      {
        id: 200,
        text: "A highlight worth keeping.",
        note: "",
        location: 42,
        location_type: "location",
        highlighted_at: "2026-06-02T10:00:00Z",
        is_deleted: false,
      },
    ],
    ...overrides,
  };
}

test("imports Kindle and iBooks book highlights into the site schema", () => {
  const library = transformReadwiseRecords(
    [
      makeRecord(),
      makeRecord({
        id: 101,
        title: "Local First",
        author: "Jane Jacobs",
        source: "ibooks",
        highlights: [
          {
            id: 201,
            text: "A local highlight.",
            location: "Chapter 1",
            location_type: "chapter",
            highlighted_at: "2026-06-02T11:00:00Z",
            is_deleted: false,
          },
        ],
      }),
    ],
    { books: [] },
    now,
  );

  assert.equal(library.exported_at, now.toISOString());
  assert.equal(library.books.length, 2);
  assert.deepEqual(
    library.books.map((book) => book.sources).flat().sort(),
    ["apple_books", "kindle"],
  );
  assert.equal(library.books.reduce((sum, book) => sum + book.highlights.length, 0), 2);
  validateLibrary(library);
});

test("excludes non-book records and deleted records", () => {
  const library = transformReadwiseRecords(
    [
      makeRecord({ category: "tweets", source: "twitter" }),
      makeRecord({ is_deleted: true }),
      makeRecord({
        title: "Visible Book",
        highlights: [
          { id: 300, text: "Deleted text", is_deleted: true },
          { id: 301, text: "Visible text", is_deleted: false },
        ],
      }),
    ],
    { books: [] },
    now,
  );

  assert.equal(library.books.length, 1);
  assert.equal(library.books[0].title, "Visible Book");
  assert.deepEqual(
    library.books[0].highlights.map((highlight) => highlight.text),
    ["Visible text"],
  );
});

test("preserves existing book and highlight IDs by normalized title and highlight text", () => {
  const existingLibrary = {
    books: [
      {
        id: "existing-book-id",
        title: "The Systems Book",
        author: "Ada Lovelace",
        sources: ["kindle"],
        highlights: [
          {
            id: "existing-highlight-id",
            text: "A highlight worth keeping.",
            note: null,
            location: { chapter: null, position: null },
            created_at: null,
            source: "kindle",
          },
        ],
        finished: null,
        finished_at: null,
      },
    ],
  };

  const library = transformReadwiseRecords([makeRecord()], existingLibrary, now);

  assert.equal(library.books.length, 1);
  assert.equal(library.books[0].id, "existing-book-id");
  assert.equal(library.books[0].highlights[0].id, "existing-highlight-id");
});

test("preserves existing book IDs by highlight overlap when Readwise metadata differs", () => {
  const existingLibrary = {
    books: [
      {
        id: "overlap-book-id",
        title: "Old Metadata",
        author: "Someone",
        sources: ["kindle"],
        highlights: [
          {
            id: "overlap-highlight-id",
            text: "A highlight worth keeping.",
            note: null,
            location: { chapter: null, position: null },
            created_at: null,
            source: "kindle",
          },
        ],
        finished: true,
        finished_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  const library = transformReadwiseRecords(
    [makeRecord({ title: "New Metadata", author: "Different" })],
    existingLibrary,
    now,
  );

  assert.equal(library.books[0].id, "overlap-book-id");
  assert.equal(library.books[0].finished, true);
  assert.equal(library.books[0].highlights[0].id, "overlap-highlight-id");
});

test("uses deterministic IDs for new Readwise records", () => {
  const first = transformReadwiseRecords([makeRecord()], { books: [] }, now);
  const second = transformReadwiseRecords([makeRecord()], { books: [] }, now);

  assert.equal(first.books[0].id, generateBookId("The Systems Book", "Ada Lovelace"));
  assert.equal(first.books[0].highlights[0].id, "readwise-200");
  assert.deepEqual(first, second);
});
