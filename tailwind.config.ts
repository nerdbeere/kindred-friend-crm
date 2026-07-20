import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sand: {
          DEFAULT: "#e1b382",
          shadow: "#c89666",
        },
        night: {
          DEFAULT: "#2d545e",
          shadow: "#12343b",
        },
        paper: "#f8f2e9",
      },
    },
  },
  plugins: [],
};

export default config;
