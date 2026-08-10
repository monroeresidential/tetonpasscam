// Explainer relocation (Drew-requested scope addition): the SEO H1 +
// paragraph now also render at the bottom of the app (between Sponsor and
// Footer) via this component, while the byte-frozen static copy in
// index.html stays put as the crawler/no-JS fallback (hidden from real
// users once React mounts -- see main.tsx). The two copies are
// independently authored strings, so this file's byte-parity guard is what
// actually prevents them drifting apart over time.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import About from '../../src/app/components/About';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function shellParagraphText(): string {
  const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
  const match = html.match(/<p class="mt-2 text-sm[^"]*">([\s\S]*?)<\/p>/);
  if (!match) throw new Error('index.html shell paragraph not found');
  return normalize(match[1]);
}

function shellH1Text(): string {
  const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
  const match = html.match(/<h1 class="text-2xl font-bold tracking-tight">([^<]*)<\/h1>/);
  if (!match) throw new Error('index.html shell H1 not found');
  return normalize(match[1]);
}

function shellFaqAnswerText(question: string): string {
  const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
  const escaped = question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(
    new RegExp(`<h3 class="mt-4 text-sm font-bold">${escaped}<\\/h3>\\s*<p class="mt-1 text-sm[^"]*">([\\s\\S]*?)<\\/p>`),
  );
  if (!match) throw new Error(`index.html FAQ answer for "${question}" not found`);
  return normalize(match[1]);
}

describe('About', () => {
  it('renders an h1 whose text exactly matches the static shell H1 in index.html', () => {
    render(<About />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(normalize(heading.textContent ?? '')).toBe(shellH1Text());
  });

  it("renders a paragraph whose text exactly matches the static shell's paragraph in index.html", () => {
    // Scope to the paragraph specifically, not the whole section, so this
    // stays a true byte-parity check rather than a substring match.
    const { container } = render(<About />);
    const paragraph = container.querySelector('p');
    expect(paragraph).not.toBeNull();
    expect(normalize(paragraph!.textContent ?? '')).toBe(shellParagraphText());
  });

  it('does not use the giant top-of-page headline treatment (section-heading scale instead)', () => {
    render(<About />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).not.toMatch(/text-\[40px\]|text-\[46px\]/);
  });

  it('renders an h2 "Frequently asked questions" matching the static shell', () => {
    render(<About />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(normalize(heading.textContent ?? '')).toBe('Frequently asked questions');
  });

  it.each([
    'Is Teton Pass open right now?',
    'How long is the drive from Victor to Jackson?',
    'Which cameras does this site show?',
    'Why does the pass close?',
  ])('renders an FAQ answer for "%s" that exactly matches the static shell in index.html', (question) => {
    render(<About />);
    const heading = screen.getByRole('heading', { level: 3, name: question });
    const paragraph = heading.nextElementSibling;
    expect(paragraph).not.toBeNull();
    expect(paragraph!.tagName).toBe('P');
    expect(normalize(paragraph!.textContent ?? '')).toBe(shellFaqAnswerText(question));
  });

  it('renders the same three shell links (privacy, Wyoming 511, Idaho 511) as index.html', () => {
    render(<About />);
    const privacyLink = screen.getByRole('link', { name: 'Privacy policy' });
    const wyLink = screen.getByRole('link', { name: 'Wyoming 511' });
    const idLink = screen.getByRole('link', { name: 'Idaho 511' });
    expect(privacyLink.getAttribute('href')).toBe('/privacy');
    expect(wyLink.getAttribute('href')).toBe('https://www.wyoroad.info');
    expect(idLink.getAttribute('href')).toBe('https://511.idaho.gov');
  });
});
