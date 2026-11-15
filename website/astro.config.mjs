// The docs. Static, self-contained, and fine with no internet: nothing here loads from anywhere else.
// BASE_PATH=/docs/ npm run build puts it under a subfolder; SITE_URL adds canonical links and a sitemap.
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { existsSync, readFileSync } from 'node:fs';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightPageActions from 'starlight-page-actions';
import { fileURLToPath } from 'node:url';

const base = process.env.BASE_PATH ?? '/';
const json = (f, none) => existsSync(new URL(f, import.meta.url)) ? JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')) : none;
const integrations = json('./src/generated/sidebar.json', []), cards = json('./src/generated/cards.json', []);

/** Markdown links are written from the site root; this puts them under the base when there is one. */
const rebase = () => tree => {
  if (base === '/') return;
  const prefix = base.replace(/\/$/, '');
  const walk = n => { if (n.tagName === 'a' && /^\/(?!\/)/.test(n.properties?.href ?? '')) n.properties.href = prefix + n.properties.href; n.children?.forEach(walk); };
  walk(tree);
};

export default defineConfig({
  base,
  site: process.env.SITE_URL,
  trailingSlash: 'always',
  output: 'static',
  image: { service: { entrypoint: 'astro/assets/services/noop' } },
  markdown: { rehypePlugins: [rebase] },
  vite: { resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } } },
  integrations: [starlight({
    title: 'Valet',
    logo: { src: './src/assets/logo.svg', alt: 'Valet' },
    favicon: '/favicon.svg',
    description: 'Talk to your homelab. A self-hosted, open-source, AI-native homepage.',
    social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/askvalet/valet' }],
    customCss: ['@fontsource-variable/geist', '@fontsource-variable/geist-mono', './src/styles/valet.css'],
    expressiveCode: { themes: ['github-dark-default', 'github-light-default'], styleOverrides: { borderRadius: '0.75rem', frames: { shadowColor: 'transparent', editorActiveTabIndicatorTopColor: 'transparent', terminalTitlebarDotsOpacity: '0.4' } } },
    pagination: true,
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    // for agents: /llms.txt, /llms-full.txt and /llms-small.txt, and on every page a Markdown copy (page.md) with a button
    // to copy it or open it in a chat. No share menu, and llms.txt comes from the plugin made for it.
    plugins: [
      starlightLlmsTxt({ projectName: 'Valet', description: 'Valet is a self-hosted, open-source, AI-native homepage for a homelab: live cards for its services, an assistant that can act on them with approval, and a wall display. Configured in one config.yaml; runs in Docker.' }),
      starlightPageActions({ actions: { chatgpt: true, claude: true, markdown: true }, share: false }),
      ...(process.env.NO_LINK_CHECK ? [] : [starlightLinksValidator({ errorOnRelativeLinks: false, errorOnFallbackPages: false, errorOnInvalidHashes: true })]),
    ],
    sidebar: [
      { label: 'Get started', items: [{ label: 'Introduction', link: '/' }, { autogenerate: { directory: 'start' } }] },
      { label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
      { label: 'Configuration', items: [{ label: 'Reference', link: '/reference/configuration/' }] },
      { label: 'Assistant', items: [{ autogenerate: { directory: 'assistant' } }] },
      { label: 'Security', items: [{ autogenerate: { directory: 'security' } }] },
      { label: 'Card gallery', collapsed: true, items: cards },
      { label: 'Integrations', items: [{ label: 'All integrations', link: '/integrations/' }, ...integrations] },
      { label: 'Build', items: [{ autogenerate: { directory: 'build' } }] },
      { label: 'More', items: [{ label: 'Recipes', link: '/recipes/' }, { label: 'FAQ', link: '/faq/' }, { label: 'Credits', link: '/credits/' }] },
    ],
  })],
});
