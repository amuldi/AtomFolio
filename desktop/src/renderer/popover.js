const root = document.getElementById('root');

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

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

function renderConnected(state) {
  const fragment = document.createDocumentFragment();

  const header = el('div', 'header', [
    el('span', 'header__brand', ['AtomFolio']),
    el('div', 'header__meta', [
      el('span', 'header__updated', [state.lastUpdatedAt ? formatTime(state.lastUpdatedAt) : '']),
      (() => {
        const button = el('button', 'header__disconnect', ['연결 해제']);
        button.addEventListener('click', () => window.atomfolio.disconnect());
        return button;
      })(),
    ]),
  ]);
  fragment.append(header);

  const totals = state.totals;
  const returnRate = totals?.totalReturnRate;
  const profitAmount = totals?.totalProfitAmount;
  const tone = Number(returnRate) > 0 ? 'is-profit' : Number(returnRate) < 0 ? 'is-loss' : '';

  const totalsBlock = el('div', 'totals', [
    el('div', 'totals__value', [totals ? formatCurrency(totals.totalMarketValue) : '—']),
    el('div', 'totals__row', [
      totals && Number.isFinite(returnRate)
        ? el('span', `totals__chip ${tone}`.trim(), [
            `${formatCurrency(profitAmount)} · ${formatPercent(returnRate)}`,
          ])
        : null,
      totals ? el('span', 'totals__note', [`${totals.holdingsCount}개 종목`]) : null,
    ]),
  ]);
  fragment.append(totalsBlock);

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
  root.innerHTML = '';

  if (!state?.connected) {
    root.append(renderConnect(state));
    return;
  }

  root.append(renderConnected(state));
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
