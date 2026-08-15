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

## 2026-08-16

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| (user-reported, with screenshot) The "auto-link asset class when adding a stock" feature shipped the day before didn't actually work — still had to pick it by hand | The auto-fill guard was `!current.trim() \|\| current === '주식'` (only overwrite when blank or the default), which can't tell "the user deliberately chose this" apart from "this is just left over from a previous lookup" — search a REIT first (자산군 fills to 리츠), then without resetting the form type a bond ETF's ticker in; the new result (채권) exists but the guard sees the current value isn't '주식' and fails, so the field stays stuck on 리츠. Reproduced directly | Replaced the string check with `manualAssetClassTouchedRef`, tracking only whether the user has actually picked an asset class for the current query — resets when the stock name/ticker input changes, only locks when the user touches the dropdown directly or opens an existing holding to edit. Picking a suggestion / clicking "Apply quote" also reset it first, since those are just as much a "commit to this security" action | ✅ Fixed | (this session) |

## 2026-08-15

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| (user-reported) Grabbing the atom widget moved the window without holding ⌘ (Command) at all, and once moving it kept following the cursor indefinitely even after release | Two issues stacked. (1) The `event.metaKey` check dropped during an earlier native-drag experiment never came back when the drag mechanism was reverted to synthetic. (2) The click-through hit-test never accounted for a widget-move drag at all — since the drag starts from `.atom-section`'s outer padding, which sits outside `.atom-visual-stage`'s own bounds, the cursor being there flipped the window to click-through, which meant it stopped receiving the `pointerup` that would have ended the drag | Restored the ⌘ check in `handleWidgetDragStart`; added `widgetDragActiveRef` and folded it into the click-through's `dragInProgress`; widened the interactive check so holding ⌘ counts regardless of `.atom-visual-stage` bounds. Also fixed a related edge case: `handleNodePointerDown`/`onCenterPointerDown` now skip `stopPropagation()` when ⌘ is held, so a ⌘-drag starting on a node or the center circle still moves the window | ⚠️ Fixed, not live-verified (no way to simulate a real mouse-drag gesture in this sandbox — verified by code reading and automated tests only) | (this session) |
| (user-reported) Market news dates showed one day ahead — a story actually published on the 15th showed as the 16th | Naver News gives dates in KST with no timezone marker (`marketNews.js`'s `parsePublishedAt`), handed straight to `Date.parse()` — Vercel's serverless Node runtime defaults to UTC, so a naive-KST string reads 9 hours later than intended, crossing into the next UTC calendar day for anything published after ~3pm KST. Reproduced directly with `TZ=UTC node -e "..."` | Parses the numeric components directly and anchors via `Date.UTC(...) - 9h` (Korea has no DST, so a fixed offset is safe). Also widened the regex once testing showed Naver's raw text normalizes to two different shapes depending on whether there's a trailing period before the time. Added a regression test (`tests/market-news-date.test.mjs`) passing under both `TZ=UTC` and `TZ=Asia/Seoul` | ✅ Fixed | (this session) |
| Signing in on the web worked, but reloading the page kept showing "guest" in the settings panel — calling the API directly confirmed the server recognized the session fine, only the UI never caught up | `App.jsx`'s `loadWorkspaceSession()` only ran once, in a mount-time `useEffect`, racing Clerk's async init (including restoring an already-signed-in session from its persisted cookie). On a reload that race is usually lost — the session check fires with no Authorization header yet, and that unauthenticated result never gets rechecked afterward | `AuthPanel.jsx`'s own effect, which already knows exactly when Clerk resolves to signed in, now also calls `onAuthenticated()` at that point — not just right after a fresh sign-in submission. The handler is idempotent, so calling it an extra time is harmless | ✅ Fixed | `bfdcd34` |
| Pasting a signed-in account's workspace ID (`user:...`) into the desktop menu bar app's connect screen — exactly what the web settings screen's own instructions said to do — failed to connect | The desktop app only ever sent an `x-atomfolio-workspace-id` header; there was no code path to send an auth token (Authorization header) at all (`desktop/src/lib/api.mjs`). A `user:<id>` workspace is never granted without authentication, so the web UI's "sign in, then connect" instructions were pointing at a flow the desktop app didn't actually support | New `server/deviceTokens.mjs` — while signed in, the web app can generate a connection code (`atomfolio_dt_...`, stored only as a SHA-256 hash) that the desktop app sends as a Bearer token, authenticated server-side exactly like a Clerk token. Generate/regenerate/revoke-all UI added to both the desktop connect screen and the web settings panel | ✅ Fixed | (this session) |
| (found during a production-readiness audit, 2026-08-14) `GET /api/health` on production (`atomfolio.vercel.app`) reported `portfolioStore.driver: "memory"` — no Postgres was connected, so portfolio data lived only in serverless instance memory | `DATABASE_URL` had never been set in Vercel's production environment variables | Actually provisioned a Neon Postgres database through the Vercel Marketplace and connected `DATABASE_URL` — confirmed live that `readiness.errors`'s `store-driver-not-durable` is gone, `portfolioStore.driver` reports `"postgres"`, and real reads/writes land in Postgres | ✅ Connected | (this session) |

## 2026-08-14

| Symptom | Root cause | Fix | Status | Commit |
| --- | --- | --- | --- | --- |
| Guest workspace ids are an unsigned string, so a short/guessable id like `guest:test` — or the shared `anonymous` bucket that unauthenticated requests fall back to when no workspace id is sent — was granted full owner access in production the same as a real one | `ensureWorkspaceAccess` (`server/portfolioStore.mjs`)'s unauthenticated branch granted owner access to anything passing `isGuestWorkspaceId` (a prefix-only check), unconditionally | Added `isAcceptableGuestWorkspaceId`, which in production only, requires `guest:<id>`'s `<id>` to be a real UUID and rejects `anonymous`. Guest workspaces the app actually creates (real UUIDs) are unaffected | ✅ Fixed | (this session) |
| Total market value/buy amount/profit were wrong for a portfolio mixing domestic and foreign holdings | `portfolioAnalyticsSummary.js`'s `resolvePosition` summed buyAmount/marketValue with no currency awareness at all — a USD position's raw number was added to a KRW position's as if they were the same unit | Each holding's currency is now resolved (live quote -> ticker-shape inference -> KRW default) and converted to the base currency before summing (new `src/utils/currency.js`) | ✅ Fixed | `5f20c80` |
| The buy-price input had no currency unit shown at all, so it was unclear whether to type a foreign holding's buy price in USD or KRW | No unit indicator existed in the UI | Added a currency badge (USD/원) next to the label, reflecting the resolved security's currency | ✅ Fixed | `5f20c80` |
| Clicking the workspace-ID copy button did nothing in the automated test browser | `navigator.clipboard.writeText()` neither resolved nor rejected when clipboard permission was blocked in that environment — reproduced directly (45s timeout) | Raced the call against an 800ms timeout via `Promise.race`, falling back to `execCommand('copy')` when it doesn't respond in time | ✅ Fixed | `5f20c80` |
| (User-reported) Manually adding QQQM at a buy price of 370,000 for 6 shares showed a -99% return | The buy-price field's brand-new "USD" badge was informational only — it didn't stop the user from typing a 원-scale number anyway. That number was taken as a raw USD figure and compared straight against the real quote ($301.41): (301.41-370000)/370000×100 ≈ -99.9%. Reproduced directly | Turned the buy-price field into a real 원/USD toggle — whatever the user types gets converted into the security's actual trading currency before it's used for the return calc or stored (`resolveManualBuyPriceInNativeCurrency`), with a live "≈ $262.01 (converted)" hint confirming the conversion happened | ✅ Fixed | `0acfddc` |
| (User-reported) Right after the fix above, the same QQQM holding's total profit showed a nonsensical figure like -₩3,131,443,179 | `resolvePosition`'s lookup for the profit-amount field used loose substring matching, and its own candidate list ('손익'/'수익') is a substring of Korean return-rate labels like '수익률' — so it was reading the *return-rate* field ("+15.04%") as if it were the *profit-amount* field. That used to just produce a small, oddly-wrong number (15.04) — but once profitAmount started being FX-converted (the currency-mixing fix a few commits earlier), the same mix-up got multiplied by the exchange rate into a much larger, very visible one. Reproduced directly | Excluded rate-suffixed labels ("수익률"/"손익률"/"평가손익률") from the profit-amount field search (`findFieldValueExcept`, the same exclusion pattern already used for the market-value lookup) | ✅ Fixed | `86da23b` |
| (User-reported, reproduced directly) Even after both fixes above, adding QQQM at a buy price of 370,000 with the toggle left on USD still showed a correct market value but a nonsensical -₩3,131,864,635 profit | The toggle fix only worked if the user actively switched it. Its default is the security's own trading currency (USD), so leaving it untouched and typing 370,000 anyway stored that number as literally "370,000 USD" — reproducing the original -99% bug's shape and then multiplying the profit side by the exchange rate into the billions | Rebuilt the model around a "purchase currency" (what the user actually entered) tracked completely separately from "trading currency" (what the security is quoted in) — the buy price is never pre-converted, stored exactly as typed. Found along the way and fixed too: switching the toggle didn't convert an already-typed number, so an auto-filled USD price could be misread as 원 (discovered via a +140,000% return) | ✅ Fixed | `2a9b3d7` |

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
