import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineHastPlugin } from "satteri";

let readingsData = null;

function loadReadings() {
  if (readingsData !== null) {
    return readingsData;
  }

  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const readingsPath = path.join(__dirname, "../src/data/readings.json");
    const content = fs.readFileSync(readingsPath, "utf-8");
    readingsData = JSON.parse(content);
  } catch (e) {
    console.warn("Could not load readings.json:", e.message);
    readingsData = { books: [] };
  }

  return readingsData;
}

function findHighlight(id) {
  const readings = loadReadings();

  for (const book of readings.books) {
    const highlight = book.highlights.find((h) => h.id === id);
    if (highlight) {
      return { highlight, book };
    }
  }

  return null;
}

export default function satteriHighlight() {
  return defineHastPlugin({
    name: "reading-highlights",
    text(node) {
      const regex = /::highlight\[([^\]]+)\]/g;
      const value = node.value;

      if (!regex.test(value)) {
        return;
      }

      regex.lastIndex = 0;

      let html = "";
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIndex) {
          html += escapeHtml(value.slice(lastIndex, match.index));
        }

        const highlightId = match[1];
        const result = findHighlight(highlightId);

        if (result) {
          const { highlight, book } = result;
          html += `<blockquote class="reading-highlight">
<p>"${escapeHtml(highlight.text)}"</p>
<cite>${escapeHtml(book.title)}, ${escapeHtml(book.author)}</cite>
</blockquote>`;
        } else {
          html += `<span class="highlight-missing">[Highlight not found: ${escapeHtml(highlightId)}]</span>`;
        }

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < value.length) {
        html += escapeHtml(value.slice(lastIndex));
      }

      return { type: "raw", value: html };
    },
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
