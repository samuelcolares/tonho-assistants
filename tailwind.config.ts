import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-000": "#000000",
        "bg-100": "#0d0d0d",
        "bg-200": "#1a1a1a",
        "bg-300": "#262626",
        border: "#3c3c3c",
        "border-strong": "#5c5c5c",
        ink: "#ffffff",
        "ink-muted": "#bbbbbb",
        "ink-faint": "#8a8a8a",
        "on-brand": "#000000",
        "brand-start": "#ffffff",
        "brand-end": "#ffffff",
        "brand-solid": "#ffffff",
        "brand-solid-hover": "#e6e6e6",
        "brand-subtle": "#1a1a1a",
        antonio: { DEFAULT: "#f2933a", subtle: "#2a170a" },
        dante: { DEFAULT: "#3b9eff", subtle: "#0f2138" },
        bonnie: { DEFAULT: "#1eb4c8", subtle: "#0b2429" },
        compras: { DEFAULT: "#2dc98a", subtle: "#0c2a20" },
        success: { DEFAULT: "#2dc98a", subtle: "#0c2a20", on: "#000000" },
        warning: { DEFAULT: "#f4b400", subtle: "#2b230a", on: "#000000" },
        danger: { DEFAULT: "#ff6b5e", subtle: "#2c1414", on: "#000000" },
        "focus-ring": "#ffffff",

        // Compras module visual language (docs/compras-design.md)
        "cm-canvas": "#000000",
        "cm-soft": "#0d0d0d",
        "cm-card": "#1a1a1a",
        "cm-elevated": "#262626",
        "cm-hairline": "#3c3c3c",
        "cm-ink": "#ffffff",
        "cm-body-strong": "#e6e6e6",
        "cm-body": "#bbbbbb",
        "cm-muted": "#8a8a8a",
        "cm-accent": "#2dc98a",
        "cm-warn": "#f4b400",
        "cm-danger": "#ff6b5e",

        // shadcn/ui semantic aliases, mapped onto the tokens above so
        // generated components (button, dialog, etc.) pick up our palette
        // without per-component overrides.
        background: "#000000",
        foreground: "#ffffff",
        card: { DEFAULT: "#0d0d0d", foreground: "#ffffff" },
        popover: { DEFAULT: "#1a1a1a", foreground: "#ffffff" },
        primary: { DEFAULT: "#ffffff", foreground: "#000000" },
        secondary: { DEFAULT: "#1a1a1a", foreground: "#ffffff" },
        muted: { DEFAULT: "#1a1a1a", foreground: "#bbbbbb" },
        accent: { DEFAULT: "#262626", foreground: "#ffffff" },
        destructive: { DEFAULT: "#ff6b5e", foreground: "#000000" },
        input: "#3c3c3c",
        ring: "#ffffff",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
        cm: ["Inter", "Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Cascadia Mono", "ui-monospace", "Consolas", "monospace"],
      },
      backgroundImage: {
        "brand-gradient": "none",
      },
      borderRadius: {
        none: "0px",
        sm: "0px",
        DEFAULT: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        full: "9999px",
      },
      boxShadow: {
        sm: "none",
        DEFAULT: "none",
        md: "none",
        lg: "none",
        xl: "none",
        "2xl": "none",
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
