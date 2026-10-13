/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f1f7f3',
          100: '#dfeee5',
          500: '#2f7d5a',
          700: '#214f3b',
          900: '#18332a',
        },
      },
    },
  },
  plugins: [],
};
