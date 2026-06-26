import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // ── shadcn/ui semantic tokens (CSS-variable-backed) ──────────────
        border:      "hsl(var(--border))",
        input:       "hsl(var(--input))",
        ring:        "hsl(var(--ring))",
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // ── Hallnect brand palette ────────────────────────────────────────
        // Deep Maroon  – primary brand / wedding-red energy
        maroon: {
          50:  "#FBF0F2",
          100: "#F5D4DA",
          200: "#EAA9B5",
          300: "#DF7D8F",
          400: "#D4526A",
          500: "#B82644",
          600: "#9B2038",  // ← main brand
          700: "#7A1830",
          800: "#5A1024",
          900: "#3D0A18",
          950: "#20050D",
        },
        // Royal Gold  – premium accent / jewellery
        gold: {
          50:  "#FFFBEF",
          100: "#FEF3C7",
          200: "#FDDEA0",
          300: "#FBC751",
          400: "#E0A820",  // ← main accent
          500: "#C9901A",
          600: "#A87314",
          700: "#84590E",
          800: "#5F3F08",
          900: "#3A2504",
          950: "#1C1102",
        },
        // Warm Ivory  – backgrounds
        ivory: {
          50:  "#FFFEFB",
          100: "#FAF6EF",  // ← main bg
          200: "#F4ECDF",
          300: "#EDE2CE",
          400: "#E4D5B9",
          500: "#D9C8A2",
        },
        // Soft Rose  – feminine accent
        rose: {
          50:  "#FDF2F4",
          100: "#F9E4E8",
          200: "#F0C5CC",
          300: "#E6A4AF",
          400: "#D97F8E",  // ← main
          500: "#C95B6C",
          600: "#A84455",
          700: "#832F40",
          800: "#5E1E2B",
          900: "#390F19",
          950: "#180608",
        },
        // Warm Charcoal  – body text
        charcoal: {
          50:  "#F7F6F5",
          100: "#ECEAE9",
          200: "#D5D1CF",
          300: "#B5AFAB",
          400: "#918A86",
          500: "#746D69",
          600: "#605954",
          700: "#504944",
          800: "#443E39",
          900: "#3C3531",
          950: "#1A1614",  // ← near-black
        },
      },

      fontFamily: {
        sans:  ["var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["var(--font-playfair)", "Georgia", "serif"],
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      boxShadow: {
        card:        "0 1px 3px rgba(26,22,20,.06), 0 4px 16px rgba(26,22,20,.08)",
        "card-hover":"0 4px 12px rgba(26,22,20,.08), 0 12px 32px rgba(26,22,20,.12)",
        elevated:    "0 8px 32px rgba(26,22,20,.12), 0 2px 8px rgba(26,22,20,.06)",
        gold:        "0 0 0 1px rgba(201,144,26,.3), 0 4px 24px rgba(201,144,26,.15)",
        maroon:      "0 4px 24px rgba(155,32,56,.20)",
      },

      backgroundImage: {
        "gold-gradient":   "linear-gradient(135deg,#E0A820 0%,#C9901A 50%,#A87314 100%)",
        "maroon-gradient": "linear-gradient(135deg,#B82644 0%,#9B2038 50%,#7A1830 100%)",
        "hero-gradient":   "linear-gradient(135deg,#20050D 0%,#3D0A18 40%,#7A1830 80%,#9B2038 100%)",
        "shimmer-gradient":"linear-gradient(90deg,transparent 0%,rgba(255,255,255,.6) 50%,transparent 100%)",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition:  "200% 0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },

      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        shimmer:          "shimmer 1.8s linear infinite",
        "fade-in":        "fade-in 0.4s ease-out",
        "slide-up":       "slide-up 0.4s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
