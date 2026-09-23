/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#09090b',
        foreground: '#fafafa',
        card: '#18181b',
        'card-foreground': '#fafafa',
        primary: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
        },
        muted: '#27272a',
        'muted-foreground': '#a1a1aa',
        border: '#27272a',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
