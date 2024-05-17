/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{html,js}"],
  theme: {
    extend: {
      backgroundImage: {
        'woman': "url('/assets/call.jpg')"
      },
      colors: {
        thatBlue: {
          50: "#030637"
        },
        boneWhite: {
          50: "#F9F6EE"
        },
        ivory: {
          50: "#FFFFF0"
        },
        seaShell: {
          50: "#FFF5EE"
        },
        parchament: {
          50: "#FCF5F5"
        },
        thatPurple: {
          50: "#3C0753"
        },
        thatPink: {
          50: "#910A67"
        },
        waselLogo: {
          50: "#e2c7d0"
        }
      }
    },
  },
  plugins: [],
}

