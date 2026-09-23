import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Gauge } from './Gauge';

it('shows missing evidence without turning it into zero percent', () => {
  const html = renderToStaticMarkup(createElement(Gauge, { value: null, reviewCount: 0 }));
  expect(html).toContain('No recent reviews');
  expect(html).not.toContain('0%');
});

it.each([0, 0.5, 1])('reports %s neutrally with its self-rated sample size', (value) => {
  const html = renderToStaticMarkup(createElement(Gauge, { value, reviewCount: 4 }));
  expect(html).toContain(`${value * 100}%`);
  expect(html).toContain('4 self-rated reviews');
  expect(html).not.toMatch(/too easy|too hard|in target|target 40/);
});
