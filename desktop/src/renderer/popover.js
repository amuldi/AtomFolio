const root = document.getElementById('root');
const SVG_NS = 'http://www.w3.org/2000/svg';

// Persists across re-renders (render() rebuilds the whole DOM on every state push, e.g. every
// poll) so a background refresh doesn't snap the rotation back to 0 or drop the user's selection.
// Two axes (radians), not one — this is a real trackball, not a flat record-player spin: dragging
// horizontally yaws around the vertical axis, dragging vertically pitches around the horizontal
// one, same two-axis feel as the web dashboard's atom scene.
let rotationYaw = 0.4;
let rotationPitch = -0.28;
let selectedHoldingId = null;
let atomFrameId = null;
let isDraggingAtom = false;
// True once a pointerdown-then-move has actually rotated the atom past a small threshold —
// distinct from isDraggingAtom (true for the whole press, including a plain tap) so a drag that
// happens to end over a node doesn't get misread as a click on that node.
let dragMoved = false;

// --- Minimal 3D math (no Three.js in this tiny renderer — just what a trackball + perspective
// projection needs: a couple of axis rotations and a divide). Mirrors the shape of the web
// dashboard's own scene math (src/utils/scene.js's trackballVector/projectPoint) without pulling
// in the WebGL-scene dependency for a menu bar popover. ---
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CAMERA_DISTANCE = 3.2;

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function rotateAroundY(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [vector[0] * cos + vector[2] * sin, vector[1], vector[2] * cos - vector[0] * sin];
}

function rotateAroundX(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [vector[0], vector[1] * cos - vector[2] * sin, vector[1] * sin + vector[2] * cos];
}

// Fibonacci/golden-angle sphere distribution — the same even-but-organic placement
// generateAtomLayout uses for the dashboard's atoms, so holdings scatter across the whole sphere
// instead of clumping.
function sphereDirection(index, total) {
  if (total <= 1) {
    return [0, 0, 1];
  }

  const ratio = index / (total - 1);
  const y = 1 - ratio * 2;
  const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * GOLDEN_ANGLE;
  return normalize3([Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY]);
}

function projectToScreen(vector, radiusPx) {
  const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - vector[2]);
  return {
    x: vector[0] * radiusPx * perspective,
    y: vector[1] * radiusPx * perspective,
    scale: perspective,
  };
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// --- Hand-drawn "sketch" shapes, matching the web dashboard's atom aesthetic (see
// src/utils/scene.js's noise/jitter/closedSketchPath/buildLoopPath) — reimplemented locally with
// the same formulas rather than imported, since importing scene.js would pull in its `three`
// dependency, which this dependency-free popover renderer doesn't have. ---
function noise(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function jitter(seed, amount) {
  return (noise(seed) * 2 - 1) * amount;
}

function midpoint2(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

// A closed loop through jittered points around a circle, connected with quadratic curves through
// each edge's midpoint — the same construction the dashboard uses for its atom/nucleus outlines,
// which is what gives them a wobbly, hand-drawn feel instead of a mechanically perfect circle.
function buildWobbleLoopPoints(radius, seed, pointCount = 9) {
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    const ring = radius + jitter(seed + index * 1.19, radius * 0.22);
    points.push({
      x: Math.cos(angle) * ring + jitter(seed + index * 2.17, radius * 0.1),
      y: Math.sin(angle) * ring + jitter(seed + index * 3.03, radius * 0.1),
    });
  }
  return points;
}

function closedSketchPath(points) {
  const firstMid = midpoint2(points[points.length - 1], points[0]);
  let path = `M ${firstMid.x.toFixed(2)} ${firstMid.y.toFixed(2)}`;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    const mid = midpoint2(points[index], next);
    path += ` Q ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)} ${mid.x.toFixed(2)} ${mid.y.toFixed(2)}`;
  }
  return path;
}

// A gently wobbled line from the nucleus out to a node — the "bond" look, not a ruler-straight
// spoke. Seeded per holding so it stays the same shape across frames/re-renders.
function buildBondPath(originX, originY, targetX, targetY, seed) {
  const midX = (originX + targetX) / 2 + jitter(seed + 4.1, 5);
  const midY = (originY + targetY) / 2 + jitter(seed + 5.3, 5);
  return `M ${originX.toFixed(2)} ${originY.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${targetX.toFixed(2)} ${targetY.toFixed(2)}`;
}

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

function truncateLabel(value, max = 10) {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

// The atom stage: a nucleus (total portfolio) with each holding placed on a sphere around it —
// the same layout the web dashboard uses (generateAtomLayout's golden-angle sphere), rendered
// here as a 2D perspective projection instead of WebGL. Drag in any direction to tumble it in true
// 3D (yaw + pitch, full 360deg, not just a flat spin); left alone, it turns slowly on its own.
// Clicking a node pins its detail in the readout below; clicking the nucleus (or the same node
// again) returns to the total.
function renderAtomStage(state) {
  const holdings = Array.isArray(state.holdings) ? state.holdings : [];
  const totals = state.totals;

  const stage = el('div', 'atom-stage', []);
  const svg = svgEl('svg', {
    viewBox: '0 0 300 220',
    class: 'atom-stage__svg',
    role: 'img',
    'aria-label': '보유 종목 지도',
  });

  const cx = 150;
  const cy = 110;
  const sphereRadiusPx = 78;

  const spokesLayer = svgEl('g', { class: 'atom-spokes' });
  const nodesLayer = svgEl('g', { class: 'atom-nodes' });

  // Nucleus never moves, so its wobble outline can be baked once at its final position instead of
  // redrawn every frame — a closed hand-drawn loop, not a mechanical circle.
  const nucleusPoints = buildWobbleLoopPoints(13, 777, 10).map((point) => ({
    x: point.x + cx,
    y: point.y + cy,
  }));
  const nucleus = svgEl('path', {
    d: closedSketchPath(nucleusPoints),
    class: 'atom-nucleus',
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

  const nodeRefs = holdings.map((holding, index) => {
    const direction = sphereDirection(index, holdings.length);
    const isSelected = holding.id === selectedHoldingId;
    const seed = 100 + index * 47;
    // Baked once in local space (centered on 0,0) — repositioned every frame via a translate+scale
    // transform instead of rebuilding the wobble path itself, so the hand-drawn shape doesn't
    // "redraw" itself every animation tick, only move.
    const ringPoints = buildWobbleLoopPoints(4.3, seed, 8);
    const ringPath = closedSketchPath(ringPoints);

    const spoke = svgEl('path', {
      class: `atom-spoke${isSelected ? ' is-selected' : ''}`,
    });

    const nodeGroup = svgEl('g', {
      class: `atom-node${isSelected ? ' is-selected' : ''}`,
      tabindex: '0',
      role: 'button',
      'aria-label': holding.label || holding.code || '종목',
    });
    nodeGroup.dataset.holdingId = holding.id ?? '';

    const ring = svgEl('path', { d: ringPath, class: 'atom-node__ring' });
    const label = svgEl('text', { class: 'atom-node__label' });
    label.textContent = truncateLabel(holding.label || holding.code || '');
    const percent = svgEl('text', {
      class: `atom-node__percent ${toneClass(holding.returnRate)}`.trim(),
    });
    percent.textContent = formatPercent(holding.returnRate);
    const title = svgEl('title', {});
    title.textContent = holding.label || holding.code || '';
    nodeGroup.append(ring, label, percent, title);

    nodeGroup.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dragMoved) {
        return;
      }
      selectedHoldingId = selectedHoldingId === holding.id ? null : holding.id;
      render(state);
    });

    spokesLayer.append(spoke);
    nodesLayer.append(nodeGroup);

    return { direction, seed, spoke, nodeGroup, ring, label, percent };
  });

  svg.append(spokesLayer, nucleus, nodesLayer);
  stage.append(svg);

  // Repositions every node for the current rotation — called on every drag move and every idle-
  // spin animation frame. Depth (how far toward/away from the viewer a node has rotated) drives
  // both its projected distance from the nucleus and its size/opacity, which is what actually
  // reads as "3D" rather than a flat shape sliding around.
  const applyFrame = () => {
    for (const ref of nodeRefs) {
      const rotated = rotateAroundX(rotateAroundY(ref.direction, rotationYaw), rotationPitch);
      const projected = projectToScreen(rotated, sphereRadiusPx);
      const nx = cx + projected.x;
      const ny = cy + projected.y;
      const depthScale = clampNumber(projected.scale, 0.6, 1.55);
      const depthFade = (depthScale - 0.6) / (1.55 - 0.6);

      ref.spoke.setAttribute('d', buildBondPath(cx, cy, nx, ny, ref.seed));
      ref.spoke.style.opacity = String(0.22 + depthFade * 0.5);

      ref.ring.setAttribute('transform', `translate(${nx.toFixed(2)} ${ny.toFixed(2)}) scale(${depthScale.toFixed(3)})`);
      ref.nodeGroup.style.opacity = String(0.5 + depthFade * 0.5);

      const labelIsRight = nx >= cx;
      const labelX = nx + (labelIsRight ? 9 : -9);
      ref.label.setAttribute('x', String(labelX));
      ref.label.setAttribute('y', String(ny - 2));
      ref.label.setAttribute('text-anchor', labelIsRight ? 'start' : 'end');
      ref.percent.setAttribute('x', String(labelX));
      ref.percent.setAttribute('y', String(ny + 9));
      ref.percent.setAttribute('text-anchor', labelIsRight ? 'start' : 'end');
    }
  };

  applyFrame();
  wireAtomDrag(stage, applyFrame);

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

// Drag in any direction to tumble the sphere freely (both axes, unclamped — true 360deg in every
// direction, not a flat single-axis spin). Releasing lets a slow idle yaw resume from wherever the
// user left it (never snaps back), matching the web dashboard scene's "rotate to browse" feel.
function wireAtomDrag(stage, applyFrame) {
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartYaw = rotationYaw;
  let dragStartPitch = rotationPitch;

  const handlePointerMove = (event) => {
    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragMoved = true;
    }
    rotationYaw = dragStartYaw + deltaX * 0.012;
    rotationPitch = dragStartPitch + deltaY * 0.012;
    applyFrame();
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
    dragStartY = event.clientY;
    dragStartYaw = rotationYaw;
    dragStartPitch = rotationPitch;
    stage.classList.add('is-dragging');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  });

  if (atomFrameId != null) {
    cancelAnimationFrame(atomFrameId);
  }

  const idleSpin = () => {
    if (!isDraggingAtom) {
      rotationYaw += 0.0035;
      applyFrame();
    }
    atomFrameId = requestAnimationFrame(idleSpin);
  };
  atomFrameId = requestAnimationFrame(idleSpin);
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
    selectedHoldingId = null;
    void window.atomfolio.selectPortfolio(select.value);
  });

  return el('div', 'portfolio-picker', [select]);
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
  const picker = renderPortfolioPicker(state);
  if (picker) {
    fragment.append(picker);
  }
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
