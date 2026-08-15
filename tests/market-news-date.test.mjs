import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePublishedAt, formatNewsTime } from '../src/lib/marketNews.js';

// Regression test for the "article says the 15th, the site shows the 16th" bug: Naver's raw date
// text ("2026.08.15. 23:45" etc.) carries no timezone marker — it's always Korea Standard Time —
// but used to be handed straight to Date.parse(), which resolves a naive date-time string against
// whichever timezone the *process* itself is running in. That's harmless in a browser already on
// KST, but this module also runs server-side (Vercel's Node runtime, which defaults to UTC),
// where the same wall-clock numbers get read as UTC instead — 9 hours later, which crosses into
// the next KST calendar day for anything published after ~3pm KST. These assertions don't rely on
// the test runner's own TZ env var (deliberately not set here) — parsePublishedAt has to get this
// right regardless of what timezone happens to be running it.

test('parsePublishedAt anchors a naive Naver-style date-time to KST, not the host timezone', () => {
  // Naver's two common raw shapes for the same moment — a trailing period right before the time
  // ("2026.08.15. 23:45") and a plain space ("2026.08.15 23:45") — both have to resolve the same
  // way; the period gets folded into the date/time separator during normalization.
  for (const raw of ['2026.08.15. 23:45', '2026.08.15 23:45']) {
    const publishedAt = parsePublishedAt(raw);

    // The correct instant is 2026-08-15T23:45 *Korea time*, i.e. 2026-08-15T14:45:00.000Z.
    assert.equal(new Date(publishedAt).toISOString(), '2026-08-15T14:45:00.000Z', raw);

    // And displaying it back with the KST basis must show the 15th, not the 16th — this is the
    // exact symptom that was reported: an evening KST article rolling over to "look like" the
    // next day once the server had (incorrectly) treated its timestamp as UTC.
    assert.equal(formatNewsTime(publishedAt, 'ko', 'kst'), '08. 15. 오후 11:45', raw);
  }
});

test('parsePublishedAt handles a naive date with no time component (date-only)', () => {
  for (const raw of ['2026.08.15.', '2026.08.15']) {
    const publishedAt = parsePublishedAt(raw);
    assert.equal(new Date(publishedAt).toISOString(), '2026-08-14T15:00:00.000Z', raw);
    assert.equal(formatNewsTime(publishedAt, 'ko', 'kst'), '08. 15. 오전 12:00', raw);
  }
});

test('parsePublishedAt still handles relative "N분/시간/일 전" text (unaffected by the fix)', () => {
  const before = Date.now();
  const publishedAt = parsePublishedAt('3시간 전');
  const after = Date.now();

  assert.ok(publishedAt <= before - 3 * 60 * 60 * 1000 + 1000);
  assert.ok(publishedAt >= after - 3 * 60 * 60 * 1000 - 1000);
});

test('parsePublishedAt returns null for empty/unparseable input', () => {
  assert.equal(parsePublishedAt(''), null);
  assert.equal(parsePublishedAt(undefined), null);
});
