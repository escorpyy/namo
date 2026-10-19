/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#1F2A44", light: "#2B3A5C", deep: "#172034" },
        paper: "#FAF8F3",
        rule: "#D6D0C2",
      },
      fontFamily: {
        sans: ['Inter', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
