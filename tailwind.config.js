/** @type {import('tailwindcss').Config} */
export default {
  // hover: を @media (hover: hover) で囲む。これがないと iPad でも hover が
  // 適用され、タップ時に「ホバー状態になるだけ」で反応しないことがある
  future: { hoverOnlyWhenSupported: true },
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      keyframes: {
        fadein: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        popin: {
          "0%": { opacity: "0", transform: "scale(0.94) translateY(6px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-6px)" },
          "40%": { transform: "translateX(6px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
        countpop: {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        fadein: "fadein 0.18s ease-out both",
        popin: "popin 0.18s ease-out both",
        shake: "shake 0.35s ease-in-out",
        countpop: "countpop 0.5s ease-out both",
      },
    },
  },
  plugins: [],
};
