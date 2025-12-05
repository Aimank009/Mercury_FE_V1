/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        'xs': '480px',
        '3xl': '1920px',
        '4xl': '2560px',
      },
      colors: {
        mercury: {
          bg: '#1d1d1f',
          border: '#282828',
          input: '#000000',
          accent: '#00ff24',
          text: '#f4f3ee',
          muted: '#717680',
          box: '#1b2f1c',
        },
        danger: '#ff3b30',
      },
      fontFamily: {
        geist: ['var(--font-geist-sans)', 'sans-serif'],
        geistMono: ['var(--font-geist-mono)', 'monospace'],
      },
      boxShadow: {
        tooltip: '0 2px 8px rgba(0, 0, 0, 0.3)',
      },
      keyframes: {
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateX(-50%) translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0, 255, 36, 0.7)' },
          '50%': { boxShadow: '0 0 0 10px rgba(0, 255, 36, 0)' },
        },
        'session-slide-in': {
          '0%': { transform: 'translateX(400px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'session-slide-out': {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(400px)', opacity: '0' },
        },
        'order-spin': {
          'to': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'slide-down': 'slide-down 0.3s ease-out',
        'fade-in': 'fade-in 0.3s ease',
        'slide-up': 'slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        pulse: 'pulse 2s infinite',
        'session-slide-in': 'session-slide-in 0.3s ease-out forwards',
        'session-slide-out': 'session-slide-out 0.3s ease-out forwards',
        'order-spin': 'order-spin 1.1s linear infinite',
      },
    },
  },
  plugins: [],
}