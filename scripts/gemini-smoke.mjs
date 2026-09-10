// Quick check that GEMINI_API_KEY + model + structured output work.
// Usage: node scripts/gemini-smoke.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const key = env.GEMINI_API_KEY;
const model = process.argv[2] || env.GEMINI_MODEL || "gemini-3.6-flash";
if (!key) throw new Error("GEMINI_API_KEY missing from .env.local");

const text = `1. Users must sign in with email and password; sessions persist via refresh token.
2. Cart contents are saved to the account and survive a server restart.
3. Confirmation email must not contain the full card number.`;

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text:
                "Split this into atomic requirements. Return title, description, severity (critical|major|minor|trivial).\n\n" +
                text,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              description: { type: "STRING" },
              severity: { type: "STRING" },
            },
            required: ["title", "description", "severity"],
          },
        },
      },
    }),
  },
);

console.log("HTTP", res.status);
const json = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}
const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
console.log("raw:", raw);
console.log("parsed:", JSON.parse(raw));
