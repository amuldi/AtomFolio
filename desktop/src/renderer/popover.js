const root = document.getElementById('root');
const SVG_NS = 'http://www.w3.org/2000/svg';

// Persists across re-renders (render() rebuilds the whole DOM on every state push, e.g. every
// poll) so a background refresh doesn't snap the orbit back to 0deg or drop the user's selection.
let rotationDeg = 0;
let selectedHoldingId = null;
let atomFrameId = null;
let isDraggingAtom = false;
// True once a pointerdown-then-move has actually rotated the ring past a small threshold —
// distinct from isDraggingAtom (true for the whole press, including a plain tap) so a drag that
// happens to end over a node doesn't get misread as a click on that node.
let dragMoved = false;

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

function toneClass(value) {
  return Number(value) > 0 ? 'is-profit' : Number(value) < 0 ? 'is-loss' : '';
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

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    node.setAttribute(key, String(value));
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

// The atom stage: a nucleus (total portfolio) with each holding orbiting it as a node, sized by
// portfolio weight and tinted by return. Drag horizontally to rotate the ring — the same "spin to
// browse" gesture as the web app's atom scene, scaled down to a menu bar popover. Clicking a node
// pins its detail in the readout below; clicking the nucleus (or nothing) returns to the total.
function renderAtomStage(state) {
  const holdings = Array.isArray(state.holdings) ? state.holdings : [];
  const totals = state.totals;

  const stage = el('div', 'atom-stage', []);
  const svg = svgEl('svg', {
    viewBox: '0 0 320 200',
    class: 'atom-stage__svg',
    role: 'img',
    'aria-label': '보유 종목 궤도',
  });

  const cx = 160;
  const cy = 100;
  const rx = 122;
  const ry = 62;

  const orbitGroup = svgEl('g', { class: 'atom-orbit-group' });
  orbitGroup.style.setProperty('--rotate', `${rotationDeg}deg`);
  orbitGroup.style.transformOrigin = `${cx}px ${cy}px`;

  // Faint orbit path purely for visual grounding — not interactive.
  orbitGroup.append(
    svgEl('ellipse', {
      cx,
      cy,
      rx,
      ry,
      class: 'atom-orbit-ring',
    }),
  );

  const weights = holdings.map((holding) => Number(holding.weightPercent) || 0);
  const maxWeight = Math.max(1, ...weights);

  holdings.forEach((holding, index) => {
    const angle = (index / Math.max(1, holdings.length)) * Math.PI * 2;
    const nx = cx + Math.cos(angle) * rx;
    const ny = cy + Math.sin(angle) * ry;
    const weightRatio = (Number(holding.weightPercent) || 0) / maxWeight;
    const radius = 4.5 + weightRatio * 5.5;

    const node = svgEl('circle', {
      cx: nx,
      cy: ny,
      r: radius,
      class: `atom-node ${toneClass(holding.returnRate)}${
        holding.id === selectedHoldingId ? ' is-selected' : ''
      }`,
      tabindex: '0',
      role: 'button',
      'aria-label': holding.label || holding.code || '종목',
    });
    node.dataset.holdingId = holding.id ?? '';
    const title = svgEl('title', {});
    title.textContent = holding.label || holding.code || '';
    node.append(title);

    node.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dragMoved) {
        return;
      }
      selectedHoldingId = selectedHoldingId === holding.id ? null : holding.id;
      render(state);
    });

    orbitGroup.append(node);
  });

  svg.append(orbitGroup);

  const nucleus = svgEl('circle', {
    cx,
    cy,
    r: 16,
    class: `atom-nucleus ${toneClass(totals?.totalReturnRate)}`,
    role: 'button',
    'aria-label': '포트폴리오 총액',
  });
  nucleus.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dragMoved) {
      return;
    }
    selectedHoldingId = null;
    render(state);
  });
  svg.append(nucleus);

  stage.append(svg);
  wireAtomDrag(stage, orbitGroup);

  const selectedHolding = holdings.find((holding) => holding.id === selectedHoldingId) ?? null;
  const readout = renderAtomReadout(selectedHolding, totals);

  const wrapper = el('div', 'atom-section', [stage, readout]);
  return wrapper;
}

function renderAtomReadout(holding, totals) {
  if (holding) {
    return el('div', 'atom-readout', [
      el('div', 'atom-readout__label', [holding.label || holding.code || '종목']),
      el('div', 'atom-readout__value', [formatCurrency(holding.marketValue)]),
      el('div', 'atom-readout__row', [
        Number.isFinite(holding.returnRate)
          ? el('span', `atom-readout__chip ${toneClass(holding.returnRate)}`.trim(), [
              `${formatCurrency(holding.profitAmount)} · ${formatPercent(holding.returnRate)}`,
            ])
          : null,
        Number.isFinite(holding.weightPercent)
          ? el('span', 'atom-readout__note', [`비중 ${holding.weightPercent.toFixed(1)}%`])
          : null,
      ]),
    ]);
  }

  const returnRate = totals?.totalReturnRate;
  const profitAmount = totals?.totalProfitAmount;

  return el('div', 'atom-readout', [
    el('div', 'atom-readout__label', ['포트폴리오 총액']),
    el('div', 'atom-readout__value', [totals ? formatCurrency(totals.totalMarketValue) : '—']),
    el('div', 'atom-readout__row', [
      totals && Number.isFinite(returnRate)
        ? el('span', `atom-readout__chip ${toneClass(returnRate)}`.trim(), [
            `${formatCurrency(profitAmount)} · ${formatPercent(returnRate)}`,
          ])
        : null,
      totals ? el('span', 'atom-readout__note', [`${totals.holdingsCount}개 종목`]) : null,
    ]),
  ]);
}

// Pointer-drag rotates the orbit group; releasing lets a slow idle spin resume from wherever the
// user left it (never snaps back to 0), matching the "rotate to browse" feel of the web app scene.
function wireAtomDrag(stage, orbitGroup) {
  let dragStartX = 0;
  let dragStartRotation = rotationDeg;

  const applyRotation = () => {
    orbitGroup.style.setProperty('--rotate', `${rotationDeg}deg`);
  };

  const handlePointerMove = (event) => {
    const deltaX = event.clientX - dragStartX;
    if (Math.abs(deltaX) > 3) {
      dragMoved = true;
    }
    rotationDeg = dragStartRotation + deltaX * 0.6;
    applyRotation();
  };

  const handlePointerUp = () => {
    isDraggingAtom = false;
    stage.classList.remove('is-dragging');
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    isDraggingAtom = true;
    dragMoved = false;
    dragStartX = event.clientX;
    dragStartRotation = rotationDeg;
    stage.classList.add('is-dragging');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  });

  if (atomFrameId != null) {
    cancelAnimationFrame(atomFrameId);
  }

  const idleSpin = () => {
    if (!isDraggingAtom) {
      rotationDeg += 0.03;
      applyRotation();
    }
    atomFrameId = requestAnimationFrame(idleSpin);
  };
  atomFrameId = requestAnimationFrame(idleSpin);
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
  fragment.append(renderAtomStage(state));

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
    if (atomFrameId != null) {
      cancelAnimationFrame(atomFrameId);
      atomFrameId = null;
    }
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
