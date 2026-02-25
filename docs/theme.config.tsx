import React from 'react';
import type { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <strong>NovaPM</strong>,
  project: {
    link: 'https://github.com/sitharaj88/novapm',
  },
  docsRepositoryBase: 'https://github.com/sitharaj88/novapm/tree/main/docs',
  editLink: {
    component: null,
  },
  feedback: {
    content: null,
  },
  footer: {
    text: (
      <span>
        MIT {new Date().getFullYear()} ©{' '}
        <a href="https://sitharaj.in" target="_blank" rel="noopener noreferrer">
          Sitharaj Seenviasan
        </a>{' '}
        — NovaPM
      </span>
    ),
  },
  useNextSeoProps() {
    return { titleTemplate: '%s – NovaPM' };
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta property="og:title" content="NovaPM Documentation" />
      <meta property="og:description" content="Next-generation AI-powered process manager for Node.js" />
      <meta name="author" content="Sitharaj Seenviasan" />
    </>
  ),
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
};

export default config;
