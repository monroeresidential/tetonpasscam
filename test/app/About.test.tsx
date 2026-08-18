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
import userEvent from '@testing-library/user-event';
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

/** Every FAQ question in index.html's #seo-shell, in document order.
 *  Derived rather than hardcoded: the count and the list used to be written
 *  out in three places here, so adding a fifth question (2026-08-18) failed
 *  two accordion tests that cared only about "all of them". Now a new
 *  question needs no edit in this file -- the parity assertions pick it up
 *  automatically, which is the whole point of a parity guard. */
function shellQuestions(): string[] {
  const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
  return [...html.matchAll(/<h3 class="mt-4 text-sm font-bold">([^<]*)<\/h3>/g)].map((m) =>
    normalize(m[1]),
  );
}

/** How many questions <About /> renders: every shell question, plus the
 *  explainer entry the shell keeps as its H1 paragraph instead. Derived from
 *  the shell rather than hardcoded so adding a question needs no edit here. */
function aboutQuestionCount(): number {
  return shellQuestions().length + 1;
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
  it('renders no heading above the questions -- the page h1 lives at the top now', () => {
    // The visible "Teton Pass — live cams & conditions" heading sat directly
    // above the FAQ list, which is an odd place for a page title and, once
    // the explainer became a question, was the only thing left between the
    // section's top and the questions. Removed (Drew, 2026-08-18); App now
    // carries an sr-only h1 at the top of the document instead, so the page
    // still has exactly one h1 for assistive tech and rendered-DOM SEO.
    const { container } = render(<About />);
    expect(container.querySelector('h1')).toBeNull();
    // The section now opens directly on the FAQ heading: no page title, and
    // no standalone explainer paragraph (it is the first question instead).
    const section = container.querySelector('section')!;
    expect(section.firstElementChild?.tagName).toBe('H2');
  });

  // The explainer is an FAQ ENTRY for users now (Drew, 2026-08-18), not a
  // standalone paragraph. index.html's #seo-shell keeps it as a paragraph
  // directly under the H1 -- spec line 98 / P1 DoD item 15 require exactly
  // that for crawlers -- and the shell is hidden the moment React mounts, so
  // the two audiences never see the same layout. What must NOT drift is the
  // TEXT, which is why this still compares byte-for-byte against the shell.
  it("renders the explainer as an FAQ answer whose text exactly matches the static shell's paragraph", () => {
    render(<About />);
    const heading = screen.getByRole('heading', { level: 3, name: 'What is Teton Pass Cam?' });
    const paragraph = heading.nextElementSibling?.querySelector('p');
    expect(paragraph).not.toBeNull();
    expect(normalize(paragraph!.textContent ?? '')).toBe(shellParagraphText());
  });




  it('renders an h2 "Frequently asked questions" matching the static shell', () => {
    render(<About />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(normalize(heading.textContent ?? '')).toBe('Frequently asked questions');
  });

  it.each(shellQuestions())(
    'renders an FAQ answer for "%s" that exactly matches the static shell in index.html',
    (question) => {
    render(<About />);
    // Accordion structure: the h3 wraps the toggle button; the collapsible
    // wrapper div (the answer <p> inside it) is the heading's next sibling.
    // The answer stays in the DOM even while collapsed, so byte-parity is
    // checkable without expanding.
      const heading = screen.getByRole('heading', { level: 3, name: question });
      const paragraph = heading.nextElementSibling?.querySelector('p');
      expect(paragraph).not.toBeNull();
      expect(normalize(paragraph!.textContent ?? '')).toBe(shellFaqAnswerText(question));
    },
  );

  it('renders every shell question, preceded by the explainer entry', () => {
    // About carries ONE question the shell does not: the explainer, which the
    // shell renders as its H1 paragraph instead. Deliberate asymmetry -- see
    // the comment on the explainer test above -- so this asserts the exact
    // expected shape rather than plain equality, and still fails if a shell
    // question goes missing or an unexpected one appears.
    render(<About />);
    const rendered = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => normalize(h.textContent ?? ''));
    expect(rendered).toEqual(['What is Teton Pass Cam?', ...shellQuestions()]);
  });

  describe('FAQ accordion', () => {
    it('renders every question collapsed initially', () => {
      render(<About />);
      const toggles = screen.getAllByRole('button', { expanded: false });
      expect(toggles).toHaveLength(aboutQuestionCount());
      for (const toggle of toggles) {
        const wrapper = toggle.closest('h3')!.nextElementSibling!;
        expect(wrapper.className).toContain('grid-rows-[0fr]');
      }
    });

    it('clicking a question expands its answer and collapses it again on the second click', async () => {
      const user = userEvent.setup();
      render(<About />);
      const toggle = screen.getByRole('button', { name: 'Is Teton Pass open right now?' });
      const wrapper = toggle.closest('h3')!.nextElementSibling!;

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(wrapper.className).toContain('grid-rows-[1fr]');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(wrapper.className).toContain('grid-rows-[0fr]');
    });

    it('expanding one question leaves the others collapsed', async () => {
      const user = userEvent.setup();
      render(<About />);
      await user.click(screen.getByRole('button', { name: 'Why does the pass close?' }));

      expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);
      expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(
        aboutQuestionCount() - 1,
      );
    });
  });

  it('renders no link row (Footer owns the single bottom nav; the shell keeps its own links)', () => {
    render(<About />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
