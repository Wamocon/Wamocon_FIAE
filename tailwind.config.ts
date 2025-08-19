import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: '#262626',
        input: '#141414',
        ring: '#ff0000',
        background: '#0a0a0a',
        foreground: '#ffffff',
        primary: {
          DEFAULT: '#ff0000',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#141414',
          foreground: '#ffffff',
        },
        destructive: {
          DEFAULT: '#ff3333',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT: '#1f1f1f',
          foreground: '#b3b3b3',
        },
        accent: {
          DEFAULT: '#ff0000',
          foreground: '#ffffff',
        },
        popover: {
          DEFAULT: '#0f0f0f',
          foreground: '#ffffff',
        },
        card: {
          DEFAULT: '#0f0f0f',
          foreground: '#ffffff',
        },
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.25rem',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config


