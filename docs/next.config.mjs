import nextra from 'nextra';

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
});

export default withNextra({
  output: 'export',
  basePath: '/novapm',
  assetPrefix: '/novapm/',
  images: { unoptimized: true },
});
