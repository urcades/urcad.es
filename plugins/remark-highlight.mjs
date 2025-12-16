import { visit } from "unist-util-visit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Cache readings data at module load time
let readingsData = null;

function loadReadings() {
  if (readingsData !== null) {
    return readingsData;
  }

  try {
    // Resolve path relative to project root
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

export default function remarkHighlight() {
  return (tree) => {
    visit(tree, "text", (node, index, parent) => {
      // Match ::highlight[id] syntax
      const regex = /::highlight\[([^\]]+)\]/g;
      const value = node.value;

      if (!regex.test(value)) {
        return;
      }

      // Reset regex
      regex.lastIndex = 0;

      const parts = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(value)) !== null) {
        // Text before the match
        if (match.index > lastIndex) {
          parts.push({
            type: "text",
            value: value.slice(lastIndex, match.index),
          });
        }

        const highlightId = match[1];
        const result = findHighlight(highlightId);

        if (result) {
          const { highlight, book } = result;
          // Create HTML node for the blockquote
          parts.push({
            type: "html",
            value: `<blockquote class="reading-highlight">
<p>"${escapeHtml(highlight.text)}"</p>
<cite>${escapeHtml(book.title)}, ${escapeHtml(book.author)}</cite>
</blockquote>`,
          });
        } else {
          // Highlight not found
          parts.push({
            type: "html",
            value: `<span class="highlight-missing">[Highlight not found: ${escapeHtml(highlightId)}]</span>`,
          });
        }

        lastIndex = regex.lastIndex;
      }

      // Text after last match
      if (lastIndex < value.length) {
        parts.push({
          type: "text",
          value: value.slice(lastIndex),
        });
      }

      // Replace node with parts
      if (parts.length > 0) {
        parent.children.splice(index, 1, ...parts);
        return index + parts.length;
      }
    });
  };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
