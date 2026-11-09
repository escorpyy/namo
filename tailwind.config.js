/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#1F2A44", light: "#2B3A5C", deep: "#172034" },
        paper: "#FAF8F3",
        rule: "#D6D0C2",
        // Purchase documents ("ledger" surface): cool canvas, deep ink, one cobalt action colour and a single brass highlight for the net amount.
        ink: { DEFAULT: "#1B2540", soft: "#2A3556", deep: "#111A2F" },
        canvas: "#EEF1F6",
        cobalt: { 50: "#EEF3FF", 100: "#DCE6FF", 200: "#BCCFFF", 600: "#2F54D6", 700: "#2547C0", 800: "#1C3799" },
        brass: { DEFAULT: "#F0C35A", deep: "#B8860B" },
      },
      fontFamily: {
        sans: ['Inter', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
        ledger: ['"IBM Plex Sans Variable"', '"IBM Plex Sans"', "Inter", '"Segoe UI"', "system-ui", "sans-serif"],
        "ledger-mono": ['"IBM Plex Mono"', "ui-monospace", "Consolas", "monospace"],
      },
      keyframes: {
        "dialog-fade": { from: { opacity: "0" }, to: { opacity: "1" } },
        "dialog-pop": { from: { opacity: "0", transform: "translateY(8px) scale(0.96)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "dialog-fade": "dialog-fade 140ms ease-out",
        "dialog-pop": "dialog-pop 190ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
      boxShadow: {
        // Only things that float get a shadow (the open tab, dialogs, the totals bar); ordinary cards rely on their border.
        lift: "0 10px 30px -12px rgba(17, 26, 47, 0.28), 0 2px 6px -2px rgba(17, 26, 47, 0.12)",
        tab: "0 -1px 0 0 rgba(17, 26, 47, 0.04), 0 2px 0 0 #fff",
      },
    },
  },
  plugins: [],
};
