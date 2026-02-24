import React from 'react';
import type { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <strong>NovaPM</strong>,
  project: {
    link: 'https://github.com/sitharaj88/novapm',
  },
  docsRepositoryBase: 'https://github.com/sitharaj88/novapm/tree/main/docs',
  footer: {
    text: 'NovaPM — Next-generation AI-powered process manager',
  },
  useNextSeoProps() {
    return { titleTemplate: '%s – NovaPM' };
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta property="og:title" content="NovaPM Documentation" />
      <meta property="og:description" content="Next-generation AI-powered process manager" />
    </>
  ),
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
};

export default config;
