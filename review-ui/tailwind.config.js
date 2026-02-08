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
        card: '#0a0a0c',
        'card-foreground': '#fafafa',
        muted: '#27272a',
        'muted-foreground': '#a1a1aa',
        border: '#27272a',
        input: '#27272a',
        primary: '#fafafa',
        'primary-foreground': '#18181b',
        secondary: '#27272a',
        'secondary-foreground': '#fafafa',
        accent: '#27272a',
        'accent-foreground': '#fafafa',
        destructive: '#7f1d1d',
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
}
