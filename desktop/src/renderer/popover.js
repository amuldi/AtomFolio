// Header, portfolio picker, and news list — plain DOM, no build step needed. The atom visual
// itself lives in atom-view.jsx/atom-view.bundle.js (a separate React root mounted at
// #atom-visual-root, which this file never touches — see popover.html's comment on that node).
const connectRoot = document.getElementById('connect-root');
const headerRoot = document.getElementById('header-root');
const pickerRoot = document.getElementById('picker-root');
const restRoot = document.getElementById('rest-root');
const settingsRoot = document.getElementById('settings-root');

// Settings overlay state lives outside render(state) — it's a local UI toggle, not portfolio
// data, and must survive/ignore the poll-driven state pushes that drive the rest of the popover.
let settingsOpen = false;
let settingsCache = null;

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

function renderConnect(state) {
  const container = el('div', 'connect');
  container.append(el('div', 'connect__title', ['AtomFolio']));
  container.append(
    el('div', 'connect__copy', [
      '웹에서 로그인 후 연결하세요. 웹 대시보드의 설정 → Workspace 항목에 표시된 ID를 아래에 붙여넣으면 됩니다.',
    ]),
  );

  const input = el('input', 'connect__input');
  input.type = 'text';
  input.placeholder = 'Workspace ID';
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
      errorLine.textContent = '연결에 실패했습니다. Workspace ID를 확인해주세요.';
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
        button.addEventListener('click', () => toggleSettings());
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

// ---------- Settings overlay ----------

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

function updateSetting(partial) {
  settingsCache = { ...settingsCache, ...partial };
  void window.atomfolio.updateSettings(partial);
}

function renderSettingsPanel(settings) {
  const closeButton = el('button', 'settings-panel__close', ['완료']);
  closeButton.type = 'button';
  closeButton.addEventListener('click', () => {
    settingsOpen = false;
    renderSettingsOverlay();
  });

  const body = el('div', 'settings-panel__body', [
    renderToggle({
      label: '인사이트 알림',
      checked: settings.notificationsEnabled,
      onChange: (next) => updateSetting({ notificationsEnabled: next }),
    }),
    renderSlider({
      label: '새로고침 주기',
      format: (v) => `${v}초`,
      min: 15,
      max: 300,
      step: 15,
      value: settings.pollIntervalSec,
      onCommit: (v) => updateSetting({ pollIntervalSec: v }),
    }),
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

  return el('div', 'settings-panel', [
    el('div', 'settings-panel__header', [
      el('span', 'settings-panel__title', ['알림 설정']),
      closeButton,
    ]),
    body,
  ]);
}

function renderSettingsOverlay() {
  settingsRoot.classList.toggle('is-open', settingsOpen && Boolean(settingsCache));
  if (!settingsOpen || !settingsCache) {
    setChildren(settingsRoot, null);
    return;
  }
  setChildren(settingsRoot, renderSettingsPanel(settingsCache));
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
  if (settingsOpen && !settingsCache) {
    window.atomfolio.getSettings().then((settings) => {
      settingsCache = settings;
      renderSettingsOverlay();
    });
    return;
  }
  renderSettingsOverlay();
}

// Only shown once there's something to choose between — a single-portfolio workspace (the common
// case) skips straight to the atom instead of a picker with one disabled-feeling option.
function renderPortfolioPicker(state) {
  const portfolios = Array.isArray(state.portfolios) ? state.portfolios : [];
  if (portfolios.length < 2) {
    return null;
  }

  const select = el('select', '', []);
  for (const portfolio of portfolios) {
    const option = el('option', '', [`${portfolio.name} · ${portfolio.holdingsCount}개 종목`]);
    option.value = portfolio.id;
    option.selected = portfolio.id === state.selectedPortfolioId;
    select.append(option);
  }

  select.addEventListener('change', () => {
    void window.atomfolio.selectPortfolio(select.value);
  });

  return el('div', 'portfolio-picker', [select]);
}

function renderRest(state) {
  const fragment = document.createDocumentFragment();

  if (state.lastError) {
    fragment.append(el('div', 'error-banner', ['업데이트에 실패해 이전 데이터를 표시하고 있습니다.']));
  }

  fragment.append(el('div', 'section-label', ['종목 뉴스']));

  const list = el('div', 'news-list', []);
  list.id = 'news-list';

  if (!state.news?.length) {
    list.append(el('div', 'empty-state', ['표시할 뉴스가 없습니다.']));
  } else {
    for (const article of state.news) {
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
      list.append(card);
    }
  }

  fragment.append(list);
  return fragment;
}

function render(state) {
  if (!state?.connected) {
    setChildren(connectRoot, renderConnect(state));
    setChildren(headerRoot, null);
    setChildren(pickerRoot, null);
    setChildren(restRoot, null);
    settingsOpen = false;
    renderSettingsOverlay();
    return;
  }

  setChildren(connectRoot, null);
  setChildren(headerRoot, renderHeader(state));
  setChildren(pickerRoot, renderPortfolioPicker(state));
  setChildren(restRoot, renderRest(state));
}

async function bootstrap() {
  const initialState = await window.atomfolio.getState();
  render(initialState);

  window.atomfolio.onState((state) => render(state));
  window.atomfolio.onFocusArticle((articleId) => {
    const cardEl = document.querySelector(`[data-article-id="${CSS.escape(articleId ?? '')}"]`);
    cardEl?.scrollIntoView({ block: 'center' });
  });
}

bootstrap();
