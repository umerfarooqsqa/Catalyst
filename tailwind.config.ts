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
    },
  },
  plugins: [],
};

export default config;
