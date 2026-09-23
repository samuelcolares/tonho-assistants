import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-000": "#0a0b10",
        "bg-100": "#0c0e15",
        "bg-200": "#12141d",
        "bg-300": "#181b27",
        border: "#23273a",
        "border-strong": "#343a52",
        ink: "#eef0f7",
        "ink-muted": "#9298b3",
        "ink-faint": "#5c6280",
        "on-brand": "#0a0b10",
        "brand-start": "#7c5cff",
        "brand-end": "#2dd4ee",
        "brand-solid": "#6d4fe0",
        "brand-solid-hover": "#7d63e8",
        "brand-subtle": "#1c1a33",
        antonio: { DEFAULT: "#f2933a", subtle: "#2a170a" },
        dante: { DEFAULT: "#3b9eff", subtle: "#0f2138" },
        bonnie: { DEFAULT: "#1eb4c8", subtle: "#0b2429" },
        success: { DEFAULT: "#34d399", subtle: "#0f2b23", on: "#04140f" },
        warning: { DEFAULT: "#f2c94c", subtle: "#2b230a", on: "#1f1400" },
        danger: { DEFAULT: "#f87171", subtle: "#2c1414", on: "#1a0505" },
        "focus-ring": "#3b9eff",

        // shadcn/ui semantic aliases, mapped onto the tokens above so
        // generated components (button, dialog, etc.) pick up our palette
        // without per-component overrides.
        background: "#0a0b10",
        foreground: "#eef0f7",
        card: { DEFAULT: "#0c0e15", foreground: "#eef0f7" },
        popover: { DEFAULT: "#12141d", foreground: "#eef0f7" },
        primary: { DEFAULT: "#6d4fe0", foreground: "#eef0f7" },
        secondary: { DEFAULT: "#12141d", foreground: "#eef0f7" },
        muted: { DEFAULT: "#12141d", foreground: "#9298b3" },
        accent: { DEFAULT: "#181b27", foreground: "#eef0f7" },
        destructive: { DEFAULT: "#f87171", foreground: "#1a0505" },
        input: "#23273a",
        ring: "#3b9eff",
      },
      fontFamily: {
        sans: ["Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Cascadia Mono", "ui-monospace", "Consolas", "monospace"],
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #7c5cff, #2dd4ee)",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.5)",
        md: "0 8px 24px rgba(0,0,0,0.55)",
        lg: "0 24px 64px rgba(0,0,0,0.6)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
