import "server-only";
import type { BugCategory, Severity } from "@/lib/types/models";
import { suggestCategory, suggestSeverity } from "@/lib/severity";

/**
 * Requirements-document extraction via Google Gemini (structured JSON output).
 *
 * Server-only: reads GEMINI_API_KEY (never NEXT_PUBLIC_). Never call from
 * client code. Get a key at https://ai.google.dev — free-tier rate limits
 * shift often, so callers must handle a thrown error by marking the
 * document `failed` rather than losing the upload (per CLAUDE.md).
 */

// gemini-2.5-flash is closed to new API keys as of 2026; 3.6-flash is the
// current free-tier structured-output workhorse. Override with GEMINI_MODEL.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type ExtractedRequirement = {
  title: string;
  description: string;
  category_id: string | null;
  severity: Severity;
};

type GeminiItem = {
  title?: string;
  description?: string;
  /** category *name* the model picked from the provided list */
  category?: string;
  severity?: string;
};

const SEVERITIES: Severity[] = ["critical", "major", "minor", "trivial"];

export async function extractRequirements(
  documentText: string,
  categories: Pick<BugCategory, "id" | "name" | "keyword_hints" | "default_severity">[],
): Promise<ExtractedRequirement[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const text = documentText.trim().slice(0, 120_000); // keep well under context limit
  if (!text) throw new Error("Document produced no extractable text");

  const categoryNames = categories.map((c) => c.name);

  const prompt = [
    "You are a QA analyst. Split the following client requirements document into",
    "discrete, atomic, testable requirements. For each one return:",
    "- title: a short imperative summary (<= 90 chars)",
    "- description: 1-3 sentences of detail, self-contained",
    `- category: the single best fit from this list, or "" if none fit: ${JSON.stringify(categoryNames)}`,
    `- severity: one of ${JSON.stringify(SEVERITIES)} reflecting how critical this requirement is to the product`,
    "Do not invent requirements that aren't in the document. Do not merge unrelated points.",
    "",
    "=== DOCUMENT START ===",
    text,
    "=== DOCUMENT END ===",
  ].join("\n");

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            description: { type: "STRING" },
            category: { type: "STRING" },
            severity: { type: "STRING", enum: SEVERITIES },
          },
          required: ["title", "description", "severity"],
        },
      },
    },
  };

  const res = await fetch(ENDPOINT(MODEL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new Error(
        `Gemini rate-limited (free tier). Try again later. ${detail.slice(0, 300)}`,
      );
    }
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 500)}`);
  }

  const json = await res.json();
  const raw: string | undefined =
    json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini returned no content");

  let items: GeminiItem[];
  try {
    items = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned unparseable JSON");
  }
  if (!Array.isArray(items)) throw new Error("Gemini did not return a list");

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  return items
    .filter((it) => it.title && it.description)
    .map((it) => {
      const combined = `${it.title} ${it.description}`;
      // trust the model's category if valid, else fall back to keyword match
      let category_id =
        (it.category && byName.get(it.category.toLowerCase())) || null;
      if (!category_id) category_id = suggestCategory(combined, categories)?.id ?? null;

      let severity =
        it.severity && SEVERITIES.includes(it.severity as Severity)
          ? (it.severity as Severity)
          : null;
      if (!severity) severity = suggestSeverity(combined, categories)?.severity ?? "minor";

      return {
        title: it.title!.trim().slice(0, 300),
        description: it.description!.trim(),
        category_id,
        severity,
      };
    });
}
