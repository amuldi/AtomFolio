# AtomFolio Bug/Issue Log

> A different purpose from [`README.md`](../../README.md) and
> [`AtomFolio_Updates.md`](AtomFolio_Updates.md). The update log covers "what got built"; this
> document pulls out **just the bugs actually found**, tracking symptom → root cause → fix in one
> place. Bug fixes are already scattered through the dated update log too, but this collects them
> so they're scannable on their own.
>
> **This document keeps getting updated** — any bug/issue found going forward gets added here too.
> Newest entries at the top. Korean version: [`AtomFolio_Bugs.md`](AtomFolio_Bugs.md)

## Status legend

- ✅ Fixed — code changed, build/lint/tests confirmed passing
- ⚠️ Fixed, not live-verified — the code fix landed and automated checks passed, but wasn't
  confirmed by actually operating the running app before the commit (noted honestly in the commit
  message itself)
- 🗑️ Feature removed — the same problem recurred, so instead of fixing it again the feature was
  removed outright

---

## 2026-08-14

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| Total market value/buy amount/profit were wrong for a portfolio mixing domestic and foreign holdings | `portfolioAnalyticsSummary.js`'s `resolvePosition` summed buyAmount/marketValue with no currency awareness at all — a USD position's raw number was added to a KRW position's as if they were the same unit | Each holding's currency is now resolved (live quote -> ticker-shape inference -> KRW default) and converted to the base currency before summing (new `src/utils/currency.js`) | ✅ Fixed | `5f20c80` |
| The buy-price input had no currency unit shown at all, so it was unclear whether to type a foreign holding's buy price in USD or KRW | No unit indicator existed in the UI | Added a currency badge (USD/원) next to the label, reflecting the resolved security's currency | ✅ Fixed | `5f20c80` |
| Clicking the workspace-ID copy button did nothing in the automated test browser | `navigator.clipboard.writeText()` neither resolved nor rejected when clipboard permission was blocked in that environment — reproduced directly (45s timeout) | Raced the call against an 800ms timeout via `Promise.race`, falling back to `execCommand('copy')` when it doesn't respond in time | ✅ Fixed | `5f20c80` |
| (User-reported) Manually adding QQQM at a buy price of 370,000 for 6 shares showed a -99% return | The buy-price field's brand-new "USD" badge was informational only — it didn't stop the user from typing a 원-scale number anyway. That number was taken as a raw USD figure and compared straight against the real quote ($301.41): (301.41-370000)/370000×100 ≈ -99.9%. Reproduced directly | Turned the buy-price field into a real 원/USD toggle — whatever the user types gets converted into the security's actual trading currency before it's used for the return calc or stored (`resolveManualBuyPriceInNativeCurrency`), with a live "≈ $262.01 (converted)" hint confirming the conversion happened | ✅ Fixed | `0acfddc` |
| (User-reported) Right after the fix above, the same QQQM holding's total profit showed a nonsensical figure like -₩3,131,443,179 | `resolvePosition`'s lookup for the profit-amount field used loose substring matching, and its own candidate list ('손익'/'수익') is a substring of Korean return-rate labels like '수익률' — so it was reading the *return-rate* field ("+15.04%") as if it were the *profit-amount* field. That used to just produce a small, oddly-wrong number (15.04) — but once profitAmount started being FX-converted (the currency-mixing fix a few commits earlier), the same mix-up got multiplied by the exchange rate into a much larger, very visible one. Reproduced directly | Excluded rate-suffixed labels ("수익률"/"손익률"/"평가손익률") from the profit-amount field search (`findFieldValueExcept`, the same exclusion pattern already used for the market-value lookup) | ✅ Fixed | `86da23b` |

## 2026-08-13

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| Same-category connecting lines still looked wrong after the coordinate fix below (confirmed by a real screenshot the user captured) | The coordinate-space bug itself was genuinely fixed in `800397a`, but most holdings in the test portfolio shared the same category (mostly ETFs), so nearly every node counted as a "match" — the lines were positioned correctly but still read as a confusing fan/burst radiating from the selected node | Recurred a second time, so instead of fixing it again, the **line rendering was removed outright** (the `.atom-group-links` SVG and its `groupLinks` computation). The non-dimming highlight for same-category nodes was kept | 🗑️ Feature removed | `c0dac9d` |
| Same-category connecting lines rendered in the wrong position (1st occurrence) | `.atom-group-links` was a sibling of `.atom-materialize-wrapper`, so its `viewBox` was mapped against `.atom-visual-stage`'s full height (including the 52px reserved bottom padding) instead of the actual node coordinate space | Moved the SVG inside `.atom-materialize-wrapper` so it shares the same box and materialize scale as the nodes it needs to align with — the underlying coordinate bug was genuinely fixed, but the feature still recurred as a usability problem (see entry above) and was later removed | ✅ Coordinate bug itself fixed (feature later removed) | `800397a` |
| Rotation looked unnatural while the widget was in sleep mode | A sleeping widget is fully click-through and can never receive window focus, so the rotation loop's "engaged" check stayed permanently false, crawling at 0.12x speed forever | Broadcast `state.sleeping` from the main process; the renderer's rAF loop treats sleeping as always-"engaged" (full speed) via a ref | ✅ Fixed | `800397a` |
| The sleep toggle was hard to discover, buried in the settings panel | Placement mistake — it belongs next to the widget's on/off state, not in a separate settings group | Moved to the tray icon's right-click menu, next to "Show atom widget" | ✅ Fixed | `0f7f165` |
| The widget didn't always re-center on a fresh app launch (only worked when toggled off/on from the tray menu) | `createAtomWidget()` called `atomWidget.showInactive()` directly, bypassing `setAtomWidgetVisible()`, which is where the centering logic lives | Routed `createAtomWidget()` through `setAtomWidgetVisible(true)` | ✅ Fixed | `0f7f165` |
| Same-category connecting lines were dashed, clashing with the atom's existing solid bond-lines | Design choice, surfaced by direct feedback rather than a functional bug | Removed `stroke-dasharray`, switched to solid | ✅ Fixed | `095b4b2` |
| The info box shown on holding-click visually overlapped the atom | The info box had no background, so its text sat directly on top of the atom | 1st attempt: a semi-opaque black backing plate — rejected by direct feedback ("remove the black box"). 2nd attempt: `.atom-visual-stage` permanently reserves 52px of bottom padding so the atom draws smaller/higher and the info box has real empty space | ✅ Fixed | `f8eef2e` |
| Showing the widget again placed it wherever it was last dragged, instead of centered | `setAtomWidgetVisible(true)` restored the last saved position | Forced re-centering to the primary display on every show | ✅ Fixed | `f8eef2e` |
| Clicking empty space on the atom widget (no node underneath) blocked clicks from reaching the app behind it | The window is transparent but never called `setIgnoreMouseEvents`, so Electron treated the whole rectangle as an opaque hit box | Added a `document.elementFromPoint` hit-test — clicks pass through unless the cursor is over an actual interactive point (`.node-hit`/`.center-hit`, or the stage background mid-drag) | ⚠️ Fixed, not live-verified | `94797a2` |
| ⌘-drag "stuck" during a fast move of the widget | A renderer only receives `pointermove` while the cursor is over its own window; a fast drag could let the cursor outrun the window before it caught up | Replaced renderer-side delta streaming with the main process polling `screen.getCursorScreenPoint()` every 16ms | ⚠️ Fixed, not live-verified | `f8eef2e` |
| Releasing ⌘ mid-drag didn't stop the window from following the cursor until the mouse button was also released | `handleStagePointerDown` only checked `metaKey` once, at drag start; the pointermove handler never re-checked it | `handleMove` now checks `event.metaKey` on every event and ends the drag the instant ⌘ is released | ⚠️ Fixed, not live-verified | `d5cbba2` |

## 2026-08-12

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| The atom was nearly invisible in light mode | Halo and alpha-blending stacked asymmetrically; a separate JS-driven SVG opacity value stayed low independent of the CSS fix | Fixed halo/alpha asymmetry, boosted JS-driven SVG opacity, hard-coded main line/node/label color to pure black, dropped group blur/depth-jitter, thickened strokes/nodes | ✅ Fixed (light mode was ultimately removed entirely) | `8281107`, `2ea03b6`, `55e30c0`, `38303e7`, `e8b2a6d` |
| Holdings matching certain name patterns silently vanished from the atom scene | The re-check step's name-pattern filter was catching valid holdings too | Fixed the re-check logic | ✅ Fixed | `ccc3ce6` |
| A `.manual.csv` suffix got appended to manually-created portfolio names | The save path always appended the suffix regardless of whether creation was manual | Skip the suffix for manually-created portfolios | ✅ Fixed | `cd6e562` |

## 2026-08-10

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| The atom widget disappeared during macOS Spaces/fullscreen transitions | Window-level workspace-visibility/level settings didn't follow Spaces switches | Adjusted window settings | ✅ Fixed | `bbb9bdd` |
| Merely hovering the widget (no click) started moving it | An earlier commit's quick-add hiding logic over-broadened the hover condition | Reverted the condition so hover alone no longer starts a move | ✅ Fixed | `0030179` |

## 2026-08-08

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| ⌘+drag didn't actually move the window | The move gesture and the rotate gesture logic conflicted with each other | Split the two gestures so they're handled independently | ✅ Fixed | `ab4da79` |

## 2026-08-05

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| The packaged menu bar app crashed silently with no window ever appearing | Resource-path resolution differed between dev and packaged builds, throwing during init in a way that got swallowed | Fixed path resolution and stopped swallowing the error | ✅ Fixed | `03e6c77` |
| `PortfolioAllocationCard` dropped its `className` prop | The component never forwarded the prop to its root element | Forwarded `className` to the root | ✅ Fixed | `ce71c43` |
| The date-basis setting didn't apply to heatmap/news timestamps | Heatmap/news rendering used a hardcoded value instead of subscribing to the setting | Subscribed to the setting | ✅ Fixed | `56a1873` |

## 2026-08-03

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| Local portfolio-store writes could lose data under concurrent writes | The save function allowed parallel calls with no serialization | Introduced a write queue to serialize saves | ✅ Fixed | `bd7ea3f` |
| The AI summary's risk/data-quality list items were missing `font-family` | A CSS selector missed those specific list items | Fixed the selector | ✅ Fixed | `8406bc9` |

## 2026-05-23

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| Imported portfolios had incorrectly parsed tickers | The CSV ticker-column parser didn't handle a certain format | Hardened the parsing logic | ✅ Fixed | `a2d40a8` |

## 2026-05-08

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| The floating tool dock didn't interact as expected | An event-handler binding issue | Fixed the handler | ✅ Fixed | `897279d` |

---

## Operational/environment notes

Not app-code bugs, but worth recording to avoid repeating them.

- **The Electron build auto-picked up the wrong signing identity**: `npm run build:mac` grabbed an
  unrelated personal Apple Development certificate from the keychain. Fixed with
  `CSC_IDENTITY_AUTO_DISCOVERY=false` to disable auto-discovery, matching the "ship unsigned"
  decision.
- **electron-builder's `dir` target isn't distributable**: `mac.target` was originally `dir` (a
  raw, unzipped `.app` folder), which can't be attached to a GitHub Release. Switched to the `zip`
  target (`89cc1c3`).
- **`git push` rejected (origin was ahead)**: 3 commits made directly via the GitHub web UI existed
  on origin before a local push. Resolved with `git fetch` + `git merge`, then pushed again.
- **Automated screenshots repeatedly picked up unrelated personal content**: full-screen capture
  kept including Notes/chat-app/other-project windows on a busy desktop, more than once. Each time,
  the file was deleted immediately; the process later switched to hiding unrelated apps via
  `System Events` first, then capturing only a specific region with `screencapture -R`. Menu bar
  app screenshots eventually moved to being captured by the user directly.
- **Production (`atomfolio.vercel.app`) hadn't redeployed in 80 days (found 2026-08-14)**: the
  Vercel project was never connected to the GitHub repo via Git integration, so pushing to `main`
  never triggered an auto-deploy — the last production deployment was stuck on May 26, meaning
  every commit from July 11 through August 13 (the WebGL rewrite, the menu bar app, Clerk auth, the
  KIS quote provider, the command palette — effectively most of this changelog) was live in the
  repo but never live on the actual site. Fixed by manually deploying the current `main` with
  `npx vercel --prod` and re-pointing `atomfolio.vercel.app` at the new deployment with
  `vercel alias set`. To prevent a repeat, whether to connect Vercel's Git integration
  (`vercel git connect`) still needs to be discussed with the user — not connected yet. Also
  surfaced along the way: `/api/health` reports `portfolioStore.driver: "memory"`,
  `databaseConfigured: false`, meaning production is running on in-memory storage rather than
  Postgres (Neon) — a separate, still-open issue.

## See also

- For the app itself, see [`README.md`](../../README.md).
- For the dated feature-change history, see [`AtomFolio_Updates.md`](AtomFolio_Updates.md).
- Korean version: [`AtomFolio_Bugs.md`](AtomFolio_Bugs.md)
