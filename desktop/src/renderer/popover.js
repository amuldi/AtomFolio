// Header/picker (fixed chrome) + a 2-page horizontal pager (news / settings) — plain DOM, no
// build step needed. The atom itself no longer lives in the popover at all — it's its own
// always-on-top floating widget now (atom-widget.html/atom-widget.css), reusing the same
// atom-view.jsx/atom-view.bundle.js React root this file never touched anyway.
const connectRoot = document.getElementById('connect-root');
const appRoot = document.getElementById('app-root');
const headerRoot = document.getElementById('header-root');
const pickerRoot = document.getElementById('picker-root');
const newsSearchRoot = document.getElementById('news-search-root');
const newsRoot = document.getElementById('news-root');
const settingsRoot = document.getElementById('settings-root');
const quickAddRoot = document.getElementById('quick-add-root');
const pagerEl = document.getElementById('pager');
const pagerTrackEl = document.getElementById('pager-track');
const pagerDotsEl = document.getElementById('pager-dots');

// Settings content is fetched once and cached — it's local IPC (not portfolio data), so it's fine
// to load eagerly alongside the rest of the page rather than waiting for the settings page to
// become visible.
let settingsCache = null;

// The last state pushed to render() — kept around so the quick-add form and news search bar
// (both rendered once at bootstrap, not rebuilt on every state push — see their creators below)
// can read the current portfolio/connection without needing their own state plumbing.
let latestState = null;

function formatTime(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  for (const child of children ?? []) {
    if (child != null) {
      node.append(child);
    }
  }
  return node;
}

function setChildren(container, node) {
  container.innerHTML = '';
  if (node != null) {
    container.append(node);
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// ---------- Pager: pointer drag + trackpad swipe (wheel deltaX) + interruptible spring snap ----------

function createPager({ container, track, dots }) {
  const PAGE_COUNT = dots.querySelectorAll('.pager-dot').length;
  const SPRING_STIFFNESS = 340;
  const SPRING_DAMPING = 32;
  const RUBBER_BAND_CONSTANT = 0.55;
  const VELOCITY_FLICK_THRESHOLD = 0.35; // px/ms — above this, a flick commits to the next/prev
  // page even if it hasn't crossed the halfway point yet.
  const AXIS_LOCK_THRESHOLD = 6; // px of movement before a drag commits to horizontal vs vertical
  const WHEEL_IDLE_MS = 120; // gap with no wheel events that means "the trackpad gesture ended"

  let pageWidth = container.getBoundingClientRect().width || 1;
  let currentIndex = 0;
  let translate = 0; // track's translateX in px, always <= 0

  let dragState = null;
  let wheelState = null;
  let springFrame = null;
  let springVelocity = 0;
  let springTarget = 0;

  const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  function measure() {
    pageWidth = container.getBoundingClientRect().width || pageWidth;
  }

  function targetTranslateFor(index) {
    return -index * pageWidth;
  }

  // iOS-style rubber-banding: resistance grows the further past the edge you pull, so it never
  // feels like it's stuck, but also never moves 1:1 with the gesture past the boundary.
  function rubberBand(overshoot) {
    return (overshoot * RUBBER_BAND_CONSTANT * pageWidth) / (pageWidth + RUBBER_BAND_CONSTANT * overshoot);
  }

  function applyRubberBand(rawTranslate) {
    const max = 0;
    const min = targetTranslateFor(PAGE_COUNT - 1);
    if (rawTranslate > max) {
      return max + rubberBand(rawTranslate - max);
    }
    if (rawTranslate < min) {
      return min - rubberBand(min - rawTranslate);
    }
    return rawTranslate;
  }

  function setTransform(value) {
    translate = value;
    track.style.transform = `translate3d(${value}px, 0, 0)`;
  }

  function stopSpring() {
    if (springFrame) {
      cancelAnimationFrame(springFrame);
      springFrame = null;
    }
  }

  function updateDots() {
    dots.querySelectorAll('.pager-dot').forEach((dot, index) => {
      dot.classList.toggle('is-active', index === currentIndex);
    });
  }

  // A real spring simulation (not a fixed-duration CSS transition) so the snap duration and
  // overshoot naturally scale with how fast the page was released, and so a new drag mid-flight
  // can just cancel this rAF loop and take over from the current position/velocity — no separate
  // "interrupt" bookkeeping needed.
  function runSpring(target, initialVelocity) {
    stopSpring();
    springTarget = target;
    springVelocity = initialVelocity;

    if (prefersReducedMotion()) {
      setTransform(target);
      return;
    }

    let last = performance.now();

    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.032);
      last = now;

      const displacement = translate - springTarget;
      const acceleration = -SPRING_STIFFNESS * displacement - SPRING_DAMPING * springVelocity;
      springVelocity += acceleration * dt;
      setTransform(translate + springVelocity * dt);

      if (Math.abs(translate - springTarget) < 0.5 && Math.abs(springVelocity) < 8) {
        setTransform(springTarget);
        springFrame = null;
        return;
      }
      springFrame = requestAnimationFrame(step);
    };

    springFrame = requestAnimationFrame(step);
  }

  function pickTargetIndex(velocityPxPerMs) {
    const progress = -translate / pageWidth;
    let target;
    if (Math.abs(velocityPxPerMs) > VELOCITY_FLICK_THRESHOLD) {
      // Negative velocity == moving toward higher indices (dragging/scrolling toward "next").
      target = velocityPxPerMs < 0 ? Math.ceil(progress) : Math.floor(progress);
    } else {
      target = Math.round(progress);
    }
    return Math.max(0, Math.min(PAGE_COUNT - 1, target));
  }

  function velocityFromSamples(samples) {
    if (samples.length < 2) {
      return 0;
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0; // px/ms
  }

  function pushSample(samples, sample) {
    samples.push(sample);
    const cutoff = sample.t - 100;
    while (samples.length > 1 && samples[0].t < cutoff) {
      samples.shift();
    }
  }

  function goToPage(index, options = {}) {
    currentIndex = Math.max(0, Math.min(PAGE_COUNT - 1, index));
    updateDots();
    const target = targetTranslateFor(currentIndex);
    if (options.instant || prefersReducedMotion()) {
      stopSpring();
      setTransform(target);
      return;
    }
    runSpring(target, options.velocity ?? 0);
  }

  // ---- Pointer (mouse/touch/pen) drag ----

  function handlePointerDown(event) {
    // Sliders (settings page) own horizontal drags on themselves — don't hijack them.
    if (event.target.closest('input[type="range"]')) {
      return;
    }
    if (dragState || (event.button != null && event.button !== 0)) {
      return;
    }
    stopSpring();
    if (wheelState) {
      clearTimeout(wheelState.idleTimer);
      wheelState = null;
    }
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTranslate: translate,
      axis: null,
      samples: [{ t: performance.now(), x: translate }],
    };
  }

  function handlePointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;

    if (dragState.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_THRESHOLD && Math.abs(dy) < AXIS_LOCK_THRESHOLD) {
        return;
      }
      if (Math.abs(dx) <= Math.abs(dy)) {
        // Vertical gesture (e.g. scrolling the news list) — hand off to native scrolling.
        dragState = null;
        return;
      }
      dragState.axis = 'x';
      // Not every pointerdown is guaranteed to have an OS-level pointer session backing it
      // (synthetic input in particular) — setPointerCapture throws NotFoundError in that case.
      // Capture is a nice-to-have here (dragging stays smooth if the cursor leaves the pager),
      // not a requirement, since move/up are already handled on window, not on `container`.
      try {
        container.setPointerCapture?.(event.pointerId);
      } catch {
        // Ignored — see comment above.
      }
    }

    event.preventDefault();
    const next = applyRubberBand(dragState.startTranslate + dx);
    setTransform(next);
    pushSample(dragState.samples, { t: performance.now(), x: next });
  }

  function handlePointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const wasDraggingX = dragState.axis === 'x';
    const velocity = wasDraggingX ? velocityFromSamples(dragState.samples) : 0;
    dragState = null;
    if (!wasDraggingX) {
      return;
    }
    goToPage(pickTargetIndex(velocity), { velocity: velocity * 1000 });
  }

  container.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove, { passive: false });
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);

  // ---- Trackpad wheel (horizontal deltaX) ----

  function handleWheel(event) {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
      return; // vertical scroll — let the page under the cursor handle it normally
    }
    event.preventDefault();
    stopSpring();

    if (!wheelState) {
      wheelState = { samples: [{ t: performance.now(), x: translate }] };
    }

    const next = applyRubberBand(translate - event.deltaX);
    setTransform(next);
    pushSample(wheelState.samples, { t: performance.now(), x: next });

    clearTimeout(wheelState.idleTimer);
    wheelState.idleTimer = setTimeout(() => {
      const velocity = velocityFromSamples(wheelState.samples);
      wheelState = null;
      goToPage(pickTargetIndex(velocity), { velocity: velocity * 1000 });
    }, WHEEL_IDLE_MS);
  }

  container.addEventListener('wheel', handleWheel, { passive: false });

  dots.querySelectorAll('.pager-dot').forEach((dot, index) => {
    dot.addEventListener('click', () => goToPage(index));
  });

  window.addEventListener('resize', () => {
    measure();
    goToPage(currentIndex, { instant: true });
  });

  measure();
  setTransform(targetTranslateFor(0));
  updateDots();

  return {
    goToPage,
    get currentIndex() {
      return currentIndex;
    },
    // True only once a drag/wheel gesture has actually committed to horizontal paging (axis
    // locked, or an active trackpad scroll) — not for the brief pre-axis-lock window, and not
    // during the post-release spring settle (that's cheap transform-only work, nothing worth
    // guarding against). Profiling (see popover.js's onState below) showed a render() DOM
    // rebuild landing in this window is what causes the swipe stutter — this is what lets
    // callers detect that window and defer.
    get isInteracting() {
      return dragState?.axis === 'x' || wheelState != null;
    },
  };
}

const pager = createPager({ container: pagerEl, track: pagerTrackEl, dots: pagerDotsEl });

// Every time the popover is actually shown, land back on the news page — a stale "you left it on
// settings last time" isn't worth remembering for a menu-bar glance.
function resetToFirstPageIfVisible() {
  if (document.visibilityState === 'visible') {
    pager.goToPage(0, { instant: true });
  }
}
document.addEventListener('visibilitychange', resetToFirstPageIfVisible);
window.addEventListener('focus', resetToFirstPageIfVisible);

function renderConnect(state) {
  const container = el('div', 'connect');
  container.append(el('div', 'connect__title', ['AtomFolio']));
  container.append(
    el('div', 'connect__copy', [
      '웹 대시보드에 로그인한 상태에서 설정 → 계정 및 워크스페이스 → "데스크톱 연결 코드 생성"으로 만든 코드를 붙여넣으세요. 로그인 없이 게스트로만 쓰던 Workspace ID도 그대로 사용할 수 있습니다.',
    ]),
  );

  const input = el('input', 'connect__input');
  input.type = 'text';
  input.placeholder = '연결 코드 또는 Workspace ID';
  input.spellcheck = false;

  const errorLine = el('div', 'connect__error', []);
  const button = el('button', 'connect__button', ['연결']);

  button.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      return;
    }

    button.disabled = true;
    button.textContent = '연결하는 중…';
    errorLine.textContent = '';

    const result = await window.atomfolio.connect(value);

    if (!result.ok) {
      errorLine.textContent =
        result.error === 'atomfolio-connect-token-invalid'
          ? '연결 코드가 만료되었거나 유효하지 않습니다. 웹에서 새로 생성해주세요.'
          : '연결에 실패했습니다. 연결 코드 또는 Workspace ID를 확인해주세요.';
      button.disabled = false;
      button.textContent = '연결';
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      button.click();
    }
  });

  container.append(input, button, errorLine);
  return container;
}

function renderHeader(state) {
  return el('div', 'header', [
    el('span', 'header__brand', ['AtomFolio']),
    el('div', 'header__meta', [
      el('span', 'header__updated', [state.lastUpdatedAt ? formatTime(state.lastUpdatedAt) : '']),
      (() => {
        const button = el('button', 'header__settings', ['⚙']);
        button.type = 'button';
        button.setAttribute('aria-label', '설정');
        // A shortcut, not a toggle — settings is a normal page now, so this just jumps there;
        // swiping or tapping another dot navigates away just like any other page.
        button.addEventListener('click', () => pager.goToPage(1));
        return button;
      })(),
      (() => {
        const button = el('button', 'header__disconnect', ['연결 해제']);
        button.addEventListener('click', () => window.atomfolio.disconnect());
        return button;
      })(),
    ]),
  ]);
}

// Custom dropdown (not a native <select>) — mounted once at bootstrap, same reasoning as
// createQuickAddForm/createNewsSearchBar: rebuilding it from scratch on every state push (poll
// tick, portfolio switch, holding-count tick) would blow away an open dropdown or lost keyboard
// focus out from under the user. Only shown once there's something to choose between — a
// single-portfolio workspace (the common case) has no need for a picker with one
// disabled-feeling option.
function createPortfolioPicker() {
  const trigger = el('button', 'portfolio-picker__trigger', []);
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const listbox = el('div', 'portfolio-picker__listbox', []);
  listbox.setAttribute('role', 'listbox');
  listbox.tabIndex = -1;
  listbox.hidden = true;

  const container = el('div', 'portfolio-picker', [trigger, listbox]);
  container.hidden = true;

  let portfolios = [];
  let selectedId = null;
  let highlightedIndex = -1;
  let isOpen = false;
  let closeTimer = null;

  const optionButtons = () => Array.from(listbox.querySelectorAll('.portfolio-picker__option'));

  function setHighlighted(index) {
    highlightedIndex = index;
    optionButtons().forEach((button, i) => {
      button.classList.toggle('is-highlighted', i === index);
    });
    optionButtons()[index]?.scrollIntoView({ block: 'nearest' });
  }

  function renderOptions() {
    listbox.innerHTML = '';
    portfolios.forEach((portfolio, index) => {
      const isSelected = portfolio.id === selectedId;
      const option = el('button', `portfolio-picker__option${isSelected ? ' is-selected' : ''}`, [
        el('span', 'portfolio-picker__option-label', [`${portfolio.name} · ${portfolio.holdingsCount}개 종목`]),
        isSelected ? el('span', 'portfolio-picker__option-check', ['✓']) : null,
      ]);
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(isSelected));
      option.addEventListener('click', () => choosePortfolio(portfolio.id));
      option.addEventListener('pointermove', () => {
        if (highlightedIndex !== index) {
          setHighlighted(index);
        }
      });
      listbox.append(option);
    });
  }

  function openList() {
    if (isOpen || portfolios.length < 2) {
      return;
    }
    clearTimeout(closeTimer);
    isOpen = true;
    listbox.hidden = false;
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    // One frame so the opacity/transform transition actually plays from the closed state instead
    // of the listbox appearing already-open (removing `hidden` and adding the class in the same
    // tick wouldn't give the browser anything to transition from).
    requestAnimationFrame(() => listbox.classList.add('is-open'));
    const currentIndex = portfolios.findIndex((portfolio) => portfolio.id === selectedId);
    setHighlighted(currentIndex >= 0 ? currentIndex : 0);
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handleKeydown, true);
  }

  function closeList({ refocusTrigger = false } = {}) {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    listbox.classList.remove('is-open');
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    document.removeEventListener('keydown', handleKeydown, true);
    // hidden=true immediately would cut the closing transition short — wait for it to finish
    // (matches the CSS's own 130ms) before actually removing the listbox from layout/a11y.
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      listbox.hidden = true;
    }, 150);
    if (refocusTrigger) {
      trigger.focus();
    }
  }

  function choosePortfolio(id) {
    closeList({ refocusTrigger: true });
    if (id === selectedId) {
      return;
    }
    showNewsLoading();
    void window.atomfolio.selectPortfolio(id);
  }

  function handleOutsidePointerDown(event) {
    if (!container.contains(event.target)) {
      closeList();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted(Math.min(portfolios.length - 1, highlightedIndex + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted(Math.max(0, highlightedIndex - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const portfolio = portfolios[highlightedIndex];
      if (portfolio) {
        choosePortfolio(portfolio.id);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeList({ refocusTrigger: true });
    } else if (event.key === 'Tab') {
      closeList();
    }
  }

  trigger.addEventListener('click', () => {
    if (isOpen) {
      closeList({ refocusTrigger: true });
    } else {
      openList();
    }
  });

  function update(state) {
    portfolios = Array.isArray(state.portfolios) ? state.portfolios : [];
    selectedId = state.selectedPortfolioId;

    if (portfolios.length < 2) {
      container.hidden = true;
      closeList();
      return;
    }
    container.hidden = false;

    const selected = portfolios.find((portfolio) => portfolio.id === selectedId);
    trigger.textContent = selected
      ? `${selected.name} · ${selected.holdingsCount}개 종목`
      : '포트폴리오 선택';

    renderOptions();
    if (isOpen) {
      // renderOptions() just rebuilt the list from scratch, which drops the .is-highlighted class
      // along with every other node — this re-adds it, but at the *preserved* index, not a reset
      // back to whatever's currently selected. update() runs on every state push, poll ticks
      // included; resetting here meant a poll tick landing between a user's arrow-key press and
      // their Enter could silently snap the highlight back to the original selection, so Enter
      // picked something other than what was visibly highlighted a moment earlier. Only clamps
      // if the list itself got shorter (portfolio removed while the picker was open).
      setHighlighted(Math.min(highlightedIndex, portfolios.length - 1));
    }
  }

  return { element: container, update };
}

const portfolioPicker = createPortfolioPicker();

// Shared by both the holdings-scoped list below and the search-results branch (search results
// carry the same title/link/source/publishedAt shape, just without an isNew flag — that badge is
// a desktop-side decoration main.js only computes for the holdings feed, see decoratedNews).
function renderNewsCard(article) {
  const card = el('button', 'news-card', []);
  card.dataset.articleId = article.id ?? '';
  card.append(
    el('div', 'news-card__title-row', [
      el('span', 'news-card__title', [article.title]),
      article.isNew ? el('span', 'news-card__badge', ['NEW']) : null,
    ]),
    el('div', 'news-card__meta', [
      [article.source, article.publishedAt ? formatTime(article.publishedAt) : null]
        .filter(Boolean)
        .join(' · '),
    ]),
  );
  card.addEventListener('click', () => {
    if (article.link) {
      window.atomfolio.openExternal(article.link);
    }
  });
  return card;
}

// { query, items, loading, error } — '' query means "not searching, show the holdings feed".
// Mutated (not replaced wholesale) by createNewsSearchBar's runSearch below; renderNewsPage just
// reads whatever's current each time it's called.
let newsSearchState = { query: '', items: null, loading: false, error: false };

function renderNewsPage(state) {
  const page = el('div', 'news-page', []);

  if (newsSearchState.query) {
    page.append(el('div', 'section-label', [`"${newsSearchState.query}" 검색 결과`]));

    if (newsSearchState.loading) {
      page.append(el('div', 'empty-state', ['불러오는 중…']));
    } else if (newsSearchState.error) {
      page.append(el('div', 'empty-state', ['검색에 실패했습니다.']));
    } else {
      const list = el('div', 'news-list', []);
      if (!newsSearchState.items?.length) {
        list.append(el('div', 'empty-state', ['검색 결과가 없습니다.']));
      } else {
        for (const article of newsSearchState.items) {
          list.append(renderNewsCard(article));
        }
      }
      page.append(list);
    }

    return page;
  }

  if (state.lastError) {
    page.append(el('div', 'error-banner', ['업데이트에 실패해 이전 데이터를 표시하고 있습니다.']));
  }

  page.append(el('div', 'section-label', ['종목 뉴스']));

  const list = el('div', 'news-list', []);
  list.id = 'news-list';

  if (!state.news?.length) {
    list.append(el('div', 'empty-state', ['표시할 뉴스가 없습니다.']));
  } else {
    for (const article of state.news) {
      list.append(renderNewsCard(article));
    }
  }

  page.append(list);
  return page;
}

// Created once at bootstrap, not rebuilt on every state push — see the module-level comment on
// latestState for why (a poll tick landing mid-keystroke would otherwise blow away focus/typed
// text). Search results themselves still go through the normal newsRoot rebuild path
// (updateNewsPage → renderNewsPage above), same as holdings news always has.
function createNewsSearchBar() {
  const input = el('input', 'news-search__input', []);
  input.type = 'search';
  input.placeholder = '뉴스 검색';
  input.spellcheck = false;

  const clearButton = el('button', 'news-search__clear', ['✕']);
  clearButton.type = 'button';
  clearButton.setAttribute('aria-label', '검색 지우기');
  clearButton.hidden = true;

  async function runSearch(rawQuery) {
    const query = rawQuery.trim();
    clearButton.hidden = !query;

    if (!query) {
      newsSearchState = { query: '', items: null, loading: false, error: false };
      updateNewsPage(latestState);
      return;
    }

    newsSearchState = { query, items: null, loading: true, error: false };
    updateNewsPage(latestState);

    try {
      const payload = await window.atomfolio.searchNews(query);
      // A slower-finishing search for a query the user has since changed (or cleared) shouldn't
      // clobber whatever's on screen for the newer one — same stale-response guard shape as
      // main.js's own latestRefreshToken.
      if (newsSearchState.query !== query) {
        return;
      }
      newsSearchState = {
        query,
        items: Array.isArray(payload?.items) ? payload.items : [],
        loading: false,
        error: false,
      };
    } catch {
      if (newsSearchState.query !== query) {
        return;
      }
      newsSearchState = { query, items: null, loading: false, error: true };
    }
    updateNewsPage(latestState);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      runSearch(input.value);
    }
  });
  clearButton.addEventListener('click', () => {
    input.value = '';
    runSearch('');
    input.focus();
  });

  return el('div', 'news-search', [input, clearButton]);
}

// Created once at bootstrap, same reasoning as createNewsSearchBar above (survives poll-tick
// rebuilds so mid-typing state isn't lost). Reads latestState.selectedPortfolioId at submit time
// rather than being passed one, since there's nothing to re-render it on a portfolio switch.
function createQuickAddForm() {
  const tickerInput = el('input', 'quick-add__input quick-add__input--ticker', []);
  tickerInput.type = 'text';
  tickerInput.placeholder = '티커';
  tickerInput.spellcheck = false;
  tickerInput.autocapitalize = 'characters';

  const qtyInput = el('input', 'quick-add__input quick-add__input--qty', []);
  qtyInput.type = 'number';
  qtyInput.placeholder = '수량';
  qtyInput.min = '0';
  qtyInput.step = 'any';

  const button = el('button', 'quick-add__button', ['추가']);
  button.type = 'button';

  const errorLine = el('div', 'quick-add__error', []);

  async function submit() {
    const ticker = tickerInput.value.trim();
    const quantity = Number(qtyInput.value);

    if (!ticker || !Number.isFinite(quantity) || quantity <= 0) {
      errorLine.textContent = '티커와 수량을 입력하세요.';
      return;
    }

    const portfolioId = latestState?.selectedPortfolioId;
    if (!portfolioId) {
      errorLine.textContent = '연결된 포트폴리오가 없습니다.';
      return;
    }

    tickerInput.disabled = true;
    qtyInput.disabled = true;
    button.disabled = true;
    button.textContent = '추가하는 중…';
    errorLine.textContent = '';

    const result = await window.atomfolio.addHolding({ portfolioId, ticker, quantity });

    tickerInput.disabled = false;
    qtyInput.disabled = false;
    button.disabled = false;
    button.textContent = '추가';

    if (result?.ok) {
      tickerInput.value = '';
      qtyInput.value = '';
      tickerInput.focus();
    } else {
      errorLine.textContent = '종목 추가에 실패했습니다.';
    }
  }

  button.addEventListener('click', submit);
  for (const input of [tickerInput, qtyInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        submit();
      }
    });
  }

  return el('div', 'quick-add', [
    el('div', 'quick-add__row', [tickerInput, qtyInput, button]),
    errorLine,
  ]);
}

function showNewsLoading() {
  if (prefersReducedMotion()) {
    return;
  }
  newsRoot.classList.add('is-loading');
}

function updateNewsPage(state) {
  setChildren(newsRoot, renderNewsPage(state));
  // A no-op unless showNewsLoading() dimmed it for an in-flight portfolio switch — removing the
  // class now lets the CSS opacity transition carry the new content back in.
  newsRoot.classList.remove('is-loading');
}

// ---------- Settings page ----------

function renderSlider({ label, format, min, max, step, value, onCommit }) {
  const valueEl = el('span', 'settings-row__value', [format(value)]);
  const row = el('div', 'settings-row', [
    el('div', 'settings-row__top', [el('span', 'settings-row__label', [label]), valueEl]),
  ]);

  const input = el('input', 'settings-slider', []);
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    valueEl.textContent = format(Number(input.value));
  });
  // Committed (and sent to main) only on release, not on every drag tick — each commit triggers a
  // config save + a silent refresh, which would otherwise fire dozens of times per drag.
  input.addEventListener('change', () => onCommit(Number(input.value)));

  row.append(input);
  return row;
}

function renderToggle({ label, checked, onChange }) {
  const track = el('button', `settings-toggle${checked ? ' is-on' : ''}`, [
    el('span', 'settings-toggle__knob', []),
  ]);
  track.type = 'button';
  track.setAttribute('role', 'switch');
  track.setAttribute('aria-checked', String(checked));
  track.addEventListener('click', () => {
    const next = !track.classList.contains('is-on');
    track.classList.toggle('is-on', next);
    track.setAttribute('aria-checked', String(next));
    onChange(next);
  });

  return el('div', 'settings-row settings-row--toggle', [
    el('span', 'settings-row__label', [label]),
    track,
  ]);
}

// Same shape as renderSlider's own row (label on top, control spanning the full width below) —
// reads as part of the same list rather than a one-off pattern. Manages its own selected-option
// class directly on click (like renderToggle's is-on toggle above) rather than expecting a full
// settings-panel re-render — nothing else in this file re-renders the panel after the initial
// load either (see ensureSettingsLoaded), every control here is responsible for its own visual
// state after the first paint.
function renderSegmented({ label, options, value, onChange }) {
  let currentValue = value;
  const buttons = [];

  const applySelection = () => {
    buttons.forEach((button, index) => {
      const isSelected = options[index].value === currentValue;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
  };

  for (const option of options) {
    const button = el('button', 'settings-segmented__option', [option.label]);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (option.value === currentValue) {
        return;
      }
      currentValue = option.value;
      applySelection();
      onChange(option.value);
    });
    buttons.push(button);
  }

  applySelection();

  return el('div', 'settings-row', [
    el('div', 'settings-row__top', [el('span', 'settings-row__label', [label])]),
    el('div', 'settings-segmented', buttons),
  ]);
}

function updateSetting(partial) {
  settingsCache = { ...settingsCache, ...partial };
  void window.atomfolio.updateSettings(partial);
}

function renderSettingsPanel(settings) {
  // Two groups, not one flat list of 9 controls — "앱 설정" (how the app itself behaves/looks)
  // vs. "투자 설정" (thresholds about the portfolio's numbers). Each is its own tinted
  // .settings-group block (see popover.css) — a label alone read as too weak a separator, but the
  // background wash is deliberately faint and borderless so it doesn't read as a nested card
  // (design system's "no card-in-card" rule) the way an outlined box would. Same internal
  // padding/gap scale on both groups — popover.css doesn't give either one a special case.
  const appSettingsGroup = el('div', 'settings-group', [
    el('div', 'section-label', ['앱 설정']),
    renderSegmented({
      label: '테마',
      options: [
        { value: 'system', label: '시스템' },
        { value: 'light', label: '라이트' },
        { value: 'dark', label: '다크' },
      ],
      value: settings.appearance,
      onChange: (next) => updateSetting({ appearance: next }),
    }),
    // Which item field the atom widget's same-category connecting lines (atom-view.jsx) group by
    // when a stock is clicked — see store.mjs's own atomCategoryDimension comment for why 분야
    // (sector) is the default rather than, say, 자산군.
    renderSegmented({
      label: '카테고리 필터',
      options: [
        { value: 'assetClass', label: '자산군' },
        { value: 'region', label: '지역' },
        { value: 'sector', label: '분야' },
        { value: 'style', label: '스타일' },
        { value: 'risk', label: '위험' },
      ],
      value: settings.atomCategoryDimension,
      onChange: (next) => updateSetting({ atomCategoryDimension: next }),
    }),
    // Below the theme picker, grouped by control type rather than the previous
    // toggle/slider/slider/slider/slider/toggle interleaving — on/off toggles first, then every
    // slider, so scanning the panel doesn't require re-parsing what kind of control each row is
    // as you go. The hairline between the two is deliberately just that (see
    // .settings-subgroup-divider in popover.css) — .settings-group is already its own tinted
    // section, so a second nested card here would be one grouping frame too many.
    renderToggle({
      label: '인사이트 알림',
      checked: settings.notificationsEnabled,
      onChange: (next) => updateSetting({ notificationsEnabled: next }),
    }),
    renderToggle({
      label: '로그인 시 자동 실행',
      checked: settings.launchAtLogin,
      onChange: (next) => updateSetting({ launchAtLogin: next }),
    }),
    // 잠자기 lives in the tray icon's right-click menu instead (main.js's tray.on('right-click')),
    // next to 원자 위젯 표시 — not here. Both are "is the widget on at all" style toggles, one
    // step removed from the news/thresholds this settings panel is otherwise about.
    el('div', 'settings-subgroup-divider'),
    renderSlider({
      label: '새로고침 주기',
      format: (v) => `${v}초`,
      min: 15,
      max: 300,
      step: 15,
      value: settings.pollIntervalSec,
      onCommit: (v) => updateSetting({ pollIntervalSec: v }),
    }),
    // Floored at 0.4 (matches main.js's own MIN_WINDOW_OPACITY re-clamp) — much lower than that
    // and the window's own text stops being legible, which defeats the point of a settings UI.
    renderSlider({
      label: '팝업 불투명도',
      format: (v) => `${Math.round(v * 100)}%`,
      min: 0.4,
      max: 1,
      step: 0.05,
      value: settings.popoverOpacity,
      onCommit: (v) => updateSetting({ popoverOpacity: v }),
    }),
    renderSlider({
      label: '원자 위젯 불투명도',
      format: (v) => `${Math.round(v * 100)}%`,
      min: 0.4,
      max: 1,
      step: 0.05,
      value: settings.widgetOpacity,
      onCommit: (v) => updateSetting({ widgetOpacity: v }),
    }),
    // Widget can also be resized by dragging its own edges directly — this is the settings-panel
    // equivalent for when that's not convenient. Bounds come from main.js (ATOM_WIDGET_MIN_WIDTH/
    // MAX_WIDTH) rather than being hardcoded here so the two can't silently drift apart.
    renderSlider({
      label: '원자 위젯 크기',
      format: (v) => `${v}px`,
      min: settings.atomWidgetSizeBounds.minWidth,
      max: settings.atomWidgetSizeBounds.maxWidth,
      step: 10,
      value: settings.atomWidgetSize.width,
      onCommit: (v) => updateSetting({ atomWidgetSize: { width: v } }),
    }),
  ]);

  const investSettingsGroup = el('div', 'settings-group', [
    el('div', 'section-label', ['투자 설정']),
    renderSlider({
      label: '손절 알림',
      format: (v) => `${v}%`,
      min: -50,
      max: -1,
      step: 1,
      value: settings.stopLossPercent,
      onCommit: (v) => updateSetting({ stopLossPercent: v }),
    }),
    renderSlider({
      label: '익절 알림',
      format: (v) => `+${v}%`,
      min: 1,
      max: 100,
      step: 1,
      value: settings.takeProfitPercent,
      onCommit: (v) => updateSetting({ takeProfitPercent: v }),
    }),
    renderSlider({
      label: '배분 이탈 허용치',
      format: (v) => `${v}%p`,
      min: 1,
      max: 50,
      step: 1,
      value: settings.allocationDriftPercent,
      onCommit: (v) => updateSetting({ allocationDriftPercent: v }),
    }),
  ]);

  const body = el('div', 'settings-panel__body', [appSettingsGroup, investSettingsGroup]);

  return el('div', 'settings-panel', [
    el('div', 'settings-panel__header', [el('span', 'settings-panel__title', ['설정'])]),
    body,
  ]);
}

async function ensureSettingsLoaded() {
  if (settingsCache) {
    setChildren(settingsRoot, renderSettingsPanel(settingsCache));
    return;
  }
  const settings = await window.atomfolio.getSettings();
  settingsCache = settings;
  setChildren(settingsRoot, renderSettingsPanel(settingsCache));
}

function render(state) {
  latestState = state;

  if (!state?.connected) {
    setChildren(connectRoot, renderConnect(state));
    appRoot.classList.add('is-hidden');
    newsRoot.classList.remove('is-loading');
    // Also closes/hides it (state.portfolios is always [] while disconnected) — harmless to skip
    // given #app-root itself is already hidden above, but keeps its internal isOpen state honest
    // rather than leaving a dropdown "open" that just happens to be invisible.
    portfolioPicker.update(state ?? {});
    return;
  }

  setChildren(connectRoot, null);
  appRoot.classList.remove('is-hidden');
  setChildren(headerRoot, renderHeader(state));
  portfolioPicker.update(state);
  updateNewsPage(state);
}

// A poll tick (or a portfolio switch's own state push) landing mid-swipe forces render() to tear
// down and rebuild header/picker/news — profiled with DevTools Tracing during a simulated drag,
// that rebuild costs several ms of Style/Layout work landing in the same frame window as the
// active pointer tracking, which is what read as the swipe stutter. While the pager is actually
// mid-gesture, incoming state is held here instead of applied immediately; only the latest one is
// kept (mid-drag intermediate states aren't worth rendering anyway), and it's flushed the moment
// the gesture ends.
let pendingRenderState = null;
let pendingRenderFlushScheduled = false;

function scheduleRenderFlushCheck() {
  if (pendingRenderFlushScheduled) {
    return;
  }
  pendingRenderFlushScheduled = true;
  const check = () => {
    if (pager.isInteracting) {
      requestAnimationFrame(check);
      return;
    }
    pendingRenderFlushScheduled = false;
    const state = pendingRenderState;
    pendingRenderState = null;
    if (state) {
      render(state);
    }
  };
  requestAnimationFrame(check);
}

function applyIncomingState(state) {
  if (pager.isInteracting) {
    pendingRenderState = state;
    scheduleRenderFlushCheck();
    return;
  }
  render(state);
}

// data-theme is the only thing popover.css's color tokens actually look at (see its own
// comment on why not `prefers-color-scheme`) — main.js resolves system/light/dark down to this
// one boolean (nativeTheme.shouldUseDarkColors) so this file never has to know which of the
// three settings produced it.
function applyTheme({ isDark } = {}) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
}

async function bootstrap() {
  // Fetched alongside (not after) getState, and applied the moment it resolves rather than
  // waiting on Promise.all for both — theming the page before its first meaningful paint is the
  // whole point, so it shouldn't be stuck behind the (usually slower) portfolio state round-trip.
  window.atomfolio.getTheme().then(applyTheme);
  window.atomfolio.onTheme(applyTheme);

  // All three mounted once, outside render()'s rebuild cycle — see their own comments for why.
  // Mounted before the first render() call below so that call's portfolioPicker.update() has
  // somewhere real to write into, rather than a detached node render() happens to reattach after.
  pickerRoot.append(portfolioPicker.element);
  quickAddRoot.append(createQuickAddForm());
  newsSearchRoot.append(createNewsSearchBar());

  const initialState = await window.atomfolio.getState();
  render(initialState);
  void ensureSettingsLoaded();

  window.atomfolio.onState((state) => applyIncomingState(state));
  window.atomfolio.onFocusArticle((articleId) => {
    pager.goToPage(0);
    const cardEl = document.querySelector(`[data-article-id="${CSS.escape(articleId ?? '')}"]`);
    cardEl?.scrollIntoView({ block: 'center' });
  });
  // Widget context-menu's "뉴스 열기"/"설정 열기" — same show-and-jump shape as onFocusArticle
  // above, just without an article to scroll to.
  window.atomfolio.onFocusPage((pageIndex) => {
    pager.goToPage(pageIndex);
  });
}

bootstrap();
