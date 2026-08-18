// Cheap regression pin (Task 16) for the exact, spec-mandated SEO strings
// in the static HTML shell: `<title>`, meta description, H1, and the
// FAQPage JSON-LD block. Reads the *source* index.html (not a `dist/`
// build output) directly off disk -- node env, no jsdom/build step needed
// -- so a future edit that accidentally drifts from the byte-exact spec
// strings fails fast without needing `npm run build` first.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');

describe('index.html static SEO shell', () => {
  it('has the exact spec title', () => {
    expect(html).toContain(
      '<title>Teton Pass Cam — Live Cameras, Conditions & Drive Times</title>',
    );
  });

  it('has the exact spec meta description', () => {
    expect(html).toContain(
      'Live Teton Pass cameras, WYDOT road conditions, summit weather, and real-time Victor–Jackson drive times. Is the pass open? Check before you cross.',
    );
  });

  it('has the exact spec H1, present in the static (pre-hydration) markup', () => {
    expect(html).toContain('<h1 class="text-2xl font-bold tracking-tight">Teton Pass — live cams & conditions</h1>');
  });

  it('has the canonical link', () => {
    expect(html).toContain('<link rel="canonical" href="https://tetonpasscam.com/" />');
  });

  // Still spec-mandated (TETONPASSCAM-SPEC.md line 98, P1 DoD item 15) even
  // though the long-form disclaimer now lives in its own FAQ entry: the
  // paragraph immediately after the H1 is the highest-weight body text on the
  // page, and it must still carry the disclaimer in short form rather than
  // relying on the reader scrolling to the questions.
  it('has a 100-150 word explainer paragraph naming data sources, update cadence, and the not-affiliated disclaimer', () => {
    const match = html.match(/<p class="mt-2 text-sm[^"]*">([\s\S]*?)<\/p>/);
    expect(match).not.toBeNull();
    const text = match![1].replace(/\s+/g, ' ').trim();
    const wordCount = text.split(' ').filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(100);
    expect(wordCount).toBeLessThanOrEqual(150);
    expect(text).toMatch(/WYDOT/);
    expect(text).toMatch(/every 10 minutes/);
    expect(text).toMatch(/not affiliated with/);
  });

  it('has a valid FAQPage JSON-LD block with exactly the five shell questions', () => {
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    const json = JSON.parse(match![1]);

    expect(json['@context']).toBe('https://schema.org');
    expect(json['@type']).toBe('FAQPage');
    expect(json.mainEntity).toHaveLength(5);

    const names = json.mainEntity.map((q: { name: string }) => q.name);
    expect(names).toEqual([
      'Is Teton Pass open right now?',
      'How long is the drive from Victor to Jackson?',
      'Which cameras does this site show?',
      'Why does the pass close?',
      'Is this an official WYDOT site?',
    ]);

    for (const question of json.mainEntity) {
      expect(question['@type']).toBe('Question');
      expect(question.acceptedAnswer['@type']).toBe('Answer');
      expect(typeof question.acceptedAnswer.text).toBe('string');
      expect(question.acceptedAnswer.text.length).toBeGreaterThan(0);
    }

    // Spot-check the specific facts each answer must convey per spec.
    expect(json.mainEntity[0].acceptedAnswer.text).toMatch(/WYDOT/);
    expect(json.mainEntity[0].acceptedAnswer.text).toMatch(/legal closure/i);
    expect(json.mainEntity[0].acceptedAnswer.text).toMatch(/\$750/);
    expect(json.mainEntity[1].acceptedAnswer.text).toMatch(/35/);
    expect(json.mainEntity[1].acceptedAnswer.text).toMatch(/45/);
    expect(json.mainEntity[2].acceptedAnswer.text).toMatch(/camera/i);
    expect(json.mainEntity[2].acceptedAnswer.text).toMatch(/WYO 22 Teton Pass -- East/);
    expect(json.mainEntity[2].acceptedAnswer.text).toMatch(/WYO 22 Teton Pass -- West/);
    expect(json.mainEntity[2].acceptedAnswer.text).toMatch(/Jackson Hole Valley/);
    expect(json.mainEntity[3].acceptedAnswer.text).toMatch(/avalanche/i);
    expect(json.mainEntity[3].acceptedAnswer.text).toMatch(/US-26/);
    expect(json.mainEntity[3].acceptedAnswer.text).toMatch(/Wyoming 511/);
    // The disclaimer moved out of the explainer paragraph and into a question
    // of its own (Drew, 2026-08-18) -- it reads stronger under its own heading
    // than buried at the end of a paragraph, and "is this official" is a real
    // search query. These assertions are the liability-relevant half: an
    // unambiguous no, and a pointer to the authoritative source.
    expect(json.mainEntity[4].acceptedAnswer.text).toMatch(/^No\./);
    expect(json.mainEntity[4].acceptedAnswer.text).toMatch(/not affiliated with/);
    expect(json.mainEntity[4].acceptedAnswer.text).toMatch(/511wy\.com/);
  });

  it('has the FAQ JSON-LD questions and answers verbatim in the visible shell markup', () => {
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    const json = JSON.parse(match![1]);
    for (const question of json.mainEntity as { name: string; acceptedAnswer: { text: string } }[]) {
      expect(html).toContain(`<h3 class="mt-4 text-sm font-bold">${question.name}</h3>`);
      const answerMatch = html.match(
        new RegExp(
          `<h3 class="mt-4 text-sm font-bold">${question.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/h3>\\s*<p class="mt-1 text-sm[^"]*">([\\s\\S]*?)<\\/p>`,
        ),
      );
      expect(answerMatch).not.toBeNull();
      const visibleText = answerMatch![1].replace(/\s+/g, ' ').trim();
      expect(visibleText).toBe(question.acceptedAnswer.text);
    }
  });

  it('mounts React into a sibling div, never the static shell container', () => {
    expect(html).toMatch(/<div id="seo-shell"[^>]*>[\s\S]*<\/div>\s*<div id="root">/);
  });

  it('has a shell (H1 + explainer + FAQ + links) totaling at least 450 words', () => {
    const match = html.match(/<div id="seo-shell"[^>]*>([\s\S]*?)<div id="root">/);
    expect(match).not.toBeNull();
    const text = match![1].replace(/<[^>]+>/g, ' ');
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(450);
  });

  it('has shell links to privacy, Wyoming 511, and Idaho 511 (audit fix #5: internal/outbound links)', () => {
    expect(html).toMatch(/<a class="underline" href="\/privacy">Privacy policy<\/a>/);
    expect(html).toMatch(/<a class="underline" href="https:\/\/www\.wyoroad\.info">Wyoming 511<\/a>/);
    expect(html).toMatch(/<a class="underline" href="https:\/\/511\.idaho\.gov">Idaho 511<\/a>/);
  });
});
