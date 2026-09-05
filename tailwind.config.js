import animate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--ink-soft) / <alpha-value>)',
        'ink-mute': 'rgb(var(--ink-mute) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          deep: 'rgb(var(--primary-deep) / <alpha-value>)',
          soft: 'rgb(var(--primary-soft) / <alpha-value>)',
        },
        coral: { DEFAULT: 'rgb(var(--coral) / <alpha-value>)', soft: 'rgb(var(--coral-soft) / <alpha-value>)' },
        amber: { DEFAULT: 'rgb(var(--amber) / <alpha-value>)', soft: 'rgb(var(--amber-soft) / <alpha-value>)' },
        mint: { DEFAULT: 'rgb(var(--mint) / <alpha-value>)', soft: 'rgb(var(--mint-soft) / <alpha-value>)' },
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Microsoft YaHei"', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 20px 60px -20px rgba(38,34,29,0.18), 0 8px 24px -12px rgba(38,34,29,0.08)',
        'card-next': '0 10px 30px -16px rgba(38,34,29,0.14)',
        pop: '0 12px 32px -8px rgba(38,34,29,0.25)',
        soft: '0 2px 10px -2px rgba(38,34,29,0.08)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'card-enter': {
          '0%': { opacity: '0', transform: 'translateY(12px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'stage-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0.995)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'stage-out': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-10px) scale(0.99)' },
        },
        /* 登录页背景动效（v0.6.1）：简报卡片漂浮 + 光斑漂移 + 点击迸裂（评审修订） */
        'float': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-16px) rotate(1.2deg)' },
        },
        'drift': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(26px, -20px) scale(1.07)' },
          '66%': { transform: 'translate(-20px, 16px) scale(0.95)' },
        },
        'burst-ring': {
          '0%': { transform: 'scale(0.15)', opacity: '0.9' },
          '100%': { transform: 'scale(1)', opacity: '0' },
        },
        'burst-bit': {
          '0%': { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translate(var(--bx, 0px), var(--by, 0px)) scale(0.3) rotate(200deg)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.3s ease both',
        'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'card-enter': 'card-enter 0.4s cubic-bezier(0.22,1,0.36,1) both',
        'stage-in': 'stage-in 0.42s cubic-bezier(0.22,1,0.36,1) both',
        'stage-out': 'stage-out 0.2s ease-in both',
        'float': 'float 7s ease-in-out infinite',
        'drift': 'drift 20s ease-in-out infinite',
        'burst-ring': 'burst-ring 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'burst-bit': 'burst-bit 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards',
      },
    },
  },
  plugins: [animate],
}
