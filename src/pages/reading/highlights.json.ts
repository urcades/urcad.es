import readings from "../../data/readings.json";

const highlightRoutes = Object.fromEntries(
  readings.books.flatMap((book: any) =>
    book.highlights.map((highlight: any) => [
      highlight.id,
      `/reading/${book.id}/#${highlight.id}`,
    ])
  )
);

export function GET() {
  return new Response(JSON.stringify(highlightRoutes), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
