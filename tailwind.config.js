/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        thatBlue: {
          50: "#030637"
        },
        thatPurple: {
          50: "#3C0753"
        },
        thatPink: {
          50: "#910A67"
        }
      }
    },
  },
  plugins: [],
}

