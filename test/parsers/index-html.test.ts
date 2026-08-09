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
      'Live Teton Pass cameras, WYDOT road conditions, summit weather, real-time Victor and Driggs to Jackson drive times, and community alerts. Is the pass open? Check before you cross.',
    );
  });

  it('has the exact spec H1, present in the static (pre-hydration) markup', () => {
    expect(html).toContain('<h1 class="text-2xl font-bold tracking-tight">Teton Pass — live cams & conditions</h1>');
  });

  it('has the canonical link', () => {
    expect(html).toContain('<link rel="canonical" href="https://tetonpasscam.com/" />');
  });

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

  it('has a valid FAQPage JSON-LD block with exactly the two spec questions', () => {
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    const json = JSON.parse(match![1]);

    expect(json['@context']).toBe('https://schema.org');
    expect(json['@type']).toBe('FAQPage');
    expect(json.mainEntity).toHaveLength(2);

    const names = json.mainEntity.map((q: { name: string }) => q.name);
    expect(names).toEqual([
      'Is Teton Pass open right now?',
      'How long is the drive from Victor to Jackson?',
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
    expect(json.mainEntity[1].acceptedAnswer.text).toMatch(/35/);
    expect(json.mainEntity[1].acceptedAnswer.text).toMatch(/45/);
  });

  it('mounts React into a sibling div, never the static shell container', () => {
    expect(html).toMatch(/<div id="seo-shell"[^>]*>[\s\S]*<\/div>\s*<div id="root">/);
  });
});
