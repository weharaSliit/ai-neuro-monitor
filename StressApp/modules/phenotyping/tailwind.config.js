/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Adding your Figma brand colors for easy use
        'brand-purple': '#7c6bf7',
        'brand-bg': '#0f0f14',
        'brand-card': '#14141f',
      },
    },
  },
  plugins: [],
}