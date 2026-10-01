import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Spreadsheet-green accent (à la Excel) instead of a Jira blue.
        brand: {
          DEFAULT: "#217346",
          fg: "#1a5c38",
          soft: "#e6f2ec",
          line: "#a8d3bd",
        },
        grid: {
          line: "#d6d9de", // cell borders
          head: "#f1f3f5", // header / row-number gutter fill
          sel: "#e3f1e9", // selected cell fill
          selline: "#217346", // selected cell outline
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        // restrained elevation for panels that float above the sheet —
        // hairline + soft shadow instead of a flat border alone.
        card: "0 1px 2px 0 rgba(15,23,42,0.04), 0 1px 1px 0 rgba(15,23,42,0.03)",
        popover:
          "0 4px 6px -2px rgba(15,23,42,0.06), 0 10px 20px -6px rgba(15,23,42,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
