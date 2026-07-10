import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Mnie',
  description: 'Self-hosted finance infrastructure.',
  appearance: false,
  themeConfig: {
    nav: [{ text: 'Docs', link: '/docs/' }],
    sidebar: {
      '/docs': [
        {
          text: 'Get Started',
          items: [{ text: 'Introduction', link: '/docs/' }],
        },
        {
          text: 'UI',
          items: [{ text: 'About', link: '/docs/ui/' }],
        },
        {
          text: 'SDK',
          items: [{ text: 'About', link: '/docs/sdk/' }],
        },
        {
          text: 'CLI',
          items: [{ text: 'About', link: '/docs/cli/' }],
        },
        {
          text: 'Providers',
          items: [
            {
              text: 'SBI Security',
              link: '/docs/providers/sbisec/',
            },
            {
              text: 'SMBC Direct',
              link: '/docs/providers/smbc-direct/',
            },
            {
              text: 'PayPay Bank',
              link: '/docs/providers/paypay-bank/',
            },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/pnsk-lab/mnie' }],
  },
})
