// 2D canvas drawing for the 비교 tab's famous-investor comparison. Kept apart from the Three.js
// stage on purpose: this lives inside the tool drawer, needs only flat sketch lines and circles,
// and has to redraw every animation frame cheaply.
//
// Two scenes, both driven by a progress value t in [0, 1]:
//   'select'  — one atom (the investor). Electrons bloom out of the nucleus.
//   'compare' — the investor's atom steps right, mine enters from the left, and every common
//               holding leaves both atoms, meets in the middle and fuses into one electron.

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPoint = (p, q, t) => ({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) });
const percent = (value) => `${Math.round(value * 100)}%`;
const LABEL_FONT = 'Gaegu, "Bradley Hand", "Marker Felt", cursive';

// Seeded so the hand-drawn jitter is identical on every frame (no shimmering lines).
function seeded(seed) {
  let state = seed >>> 0;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const rgba = (rgb, alpha) => `rgba(${rgb}, ${Math.max(0, alpha)})`;

function createPainter(ctx, colors) {
  const { ink, guru } = colors;

  function sketch(p, q, rgb, alpha, rand) {
    for (let pass = 0; pass < 2; pass += 1) {
      const mx = (p.x + q.x) / 2 + (rand() - 0.5) * 6;
      const my = (p.y + q.y) / 2 + (rand() - 0.5) * 6;
      const jitter = [rand(), rand(), rand(), rand()].map((value) => (value - 0.5) * 1.5);
      if (alpha <= 0.01) continue;
      ctx.beginPath();
      ctx.moveTo(p.x + jitter[0], p.y + jitter[1]);
      ctx.quadraticCurveTo(mx, my, q.x + jitter[2], q.y + jitter[3]);
      ctx.strokeStyle = rgba(rgb, pass ? alpha * 0.45 : alpha);
      ctx.lineWidth = pass ? 2.2 : 1.1;
      ctx.stroke();
    }
  }

  function electron(p, radius, kind, alpha = 1) {
    if (alpha <= 0.01 || radius <= 0.2) return;
    const fill = kind === 'guru' ? guru : ink;
    const glow = kind === 'mine' ? ink : guru;
    ctx.save();
    ctx.globalAlpha = alpha;
    const gradient = ctx.createRadialGradient(p.x, p.y, radius * 0.3, p.x, p.y, radius * 2.6);
    gradient.addColorStop(0, rgba(glow, kind === 'both' ? 0.4 : 0.2));
    gradient.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = rgba(fill, 0.88);
    ctx.fill();
    ctx.lineWidth = kind === 'both' ? 2.4 : 1.2;
    ctx.strokeStyle = kind === 'both' ? rgba(guru, 1) : rgba(ink, 0.9);
    ctx.stroke();
    ctx.restore();
  }

  function nucleus(p, rand, alpha = 1, scale = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2 + rand() * 0.5;
      const distance = i ? 6 * scale : 0;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(angle) * distance, p.y + Math.sin(angle) * distance, 5.2 * scale, 0, Math.PI * 2);
      ctx.fillStyle = rgba(ink, 0.16);
      ctx.fill();
      ctx.strokeStyle = rgba(ink, 0.85);
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function label(fullText, sub, p, dy, width, subRgb, size, alpha = 1) {
    if (alpha <= 0.02) return;
    // Long ETF names ("Invesco 미국 대형주 ETF") would run into neighbouring electrons.
    const maxChars = width < 440 ? 8 : 11;
    const text = fullText.length > maxChars ? `${fullText.slice(0, maxChars - 1)}…` : fullText;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${size}px ${LABEL_FONT}`;
    const textWidth = Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width * 0.86 : 0);
    const cx = Math.min(Math.max(p.x, textWidth / 2 + 6), width - textWidth / 2 - 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = rgba(ink, 0.92);
    ctx.fillText(text, cx, p.y + dy);
    if (sub) {
      ctx.font = `400 ${size - 2}px ${LABEL_FONT}`;
      ctx.fillStyle = rgba(subRgb, 0.9);
      ctx.fillText(sub, cx, p.y + dy + size - 1);
    }
    ctx.restore();
  }

  function caption(text, p, rgb, size, alpha = 1) {
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${size}px ${LABEL_FONT}`;
    ctx.fillStyle = rgba(rgb, 1);
    ctx.fillText(text, p.x, p.y);
    ctx.restore();
  }

  function ring(p, radius, alpha) {
    if (alpha <= 0.01) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(guru, alpha);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  return { sketch, electron, nucleus, label, caption, ring };
}

function prepare(canvas, colors) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (!width || !height) return null;
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const narrow = width < 440;
  const rand = seeded(7);
  for (let i = 0; i < 90; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const alpha = 0.05 + rand() * 0.25;
    if (!narrow || i % 2) {
      ctx.fillStyle = rgba(colors.ink, alpha);
      ctx.fillRect(x, y, 1.1, 1.1);
    }
  }

  const top = 78;
  const bottom = height - 58;
  const cy = (top + bottom) / 2;
  return {
    ctx,
    rand,
    narrow,
    width,
    top,
    bottom,
    cy,
    center: { x: width / 2, y: cy },
    left: { x: width * (narrow ? 0.23 : 0.26), y: cy },
    right: { x: width * (narrow ? 0.77 : 0.74), y: cy },
    reach: Math.min(width * 0.19, (bottom - top) * 0.46),
    // Vertical room is the tighter bound: leave the bottom ring's labels clear of the 비교하기 bar.
    previewReach: Math.min(width * (narrow ? 0.36 : 0.32), (bottom - top) * 0.4),
    size: (weight) => 3.4 + Math.sqrt(weight) * (narrow ? 20 : 26),
    fontSize: narrow ? 12 : 14,
    maxSide: narrow ? 5 : 7,
    maxPreview: narrow ? 9 : 12,
    maxShared: narrow ? 5 : 7,
  };
}

function previewPosition(layout, index, count) {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
  const distance = layout.previewReach * (index % 2 ? 0.72 : 1);
  return { x: layout.center.x + Math.cos(angle) * distance, y: layout.center.y + Math.sin(angle) * distance };
}

function sideOffset(layout, index, count, direction) {
  const t = count === 1 ? 0.5 : index / (count - 1);
  const angle = direction < 0 ? Math.PI * (0.62 + t * 0.76) : Math.PI * (-0.38 + t * 0.76);
  const distance = layout.reach * (index % 2 ? 0.74 : 1);
  return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance };
}

export function drawGuruScene(canvas, scene) {
  const layout = prepare(canvas, scene.colors);
  if (!layout) return;
  const paint = createPainter(layout.ctx, scene.colors);
  if (scene.kind === 'compare') {
    drawCompare(layout, paint, scene);
  } else {
    drawSelect(layout, paint, scene);
  }
}

function drawSelect(layout, paint, { t, guru, language, colors }) {
  const lang = language === 'en' ? 'en' : 'ko';
  const list = guru.holdings.slice(0, layout.maxPreview);
  const placed = list.map((holding, index) => {
    const local = easeOut(clamp01((t - index * 0.035) / 0.6));
    return { holding, local, p: lerpPoint(layout.center, previewPosition(layout, index, list.length), local) };
  });
  placed.forEach(({ p, local }) => paint.sketch(layout.center, p, colors.guru, 0.55 * local, layout.rand));
  paint.nucleus(layout.center, layout.rand, 1, 1 + 0.25 * (1 - easeOut(t)));
  placed.forEach(({ holding, p, local }) => paint.electron(p, layout.size(holding.weight) * local, 'guru', local));
  placed.forEach(({ holding, p, local }) =>
    paint.label(
      holding.name[lang],
      percent(holding.weight),
      p,
      layout.size(holding.weight) + 3,
      layout.width,
      colors.guru,
      layout.fontSize,
      clamp01((local - 0.6) / 0.4),
    ),
  );
  const nameSize = layout.narrow ? 14 : 17;
  paint.caption(guru.person[lang], { x: layout.center.x, y: layout.center.y + 16 }, colors.guru, nameSize, clamp01(t * 2));
  if (guru.holdings.length > list.length) {
    paint.caption(
      `+${guru.holdings.length - list.length}`,
      { x: layout.center.x, y: layout.center.y + 34 },
      colors.ink,
      layout.fontSize - 2,
      clamp01(t * 2) * 0.45,
    );
  }
}

function drawCompare(layout, paint, { t, guru, result, language, colors, labels }) {
  const lang = language === 'en' ? 'en' : 'ko';
  const settle = easeInOut(clamp01(t / 0.38)); // atoms take their places
  const travel = easeInOut(clamp01((t - 0.36) / 0.36)); // common electrons move to the middle
  const fuse = clamp01((t - 0.72) / 0.28); // fusion pulse, then labels
  const guruNucleus = lerpPoint(layout.center, layout.right, settle);
  const myNucleus = { x: lerp(-layout.width * 0.12, layout.left.x, settle), y: layout.cy };

  const shownShared = result.shared.slice(0, layout.maxShared);
  const middle = new Map(
    shownShared.map((holding, index) => {
      const count = shownShared.length;
      // Spread over the stage height minus room for the last label and the "+N in common" line.
      const y = count === 1 ? layout.cy : layout.top + 12 + (layout.bottom - layout.top - 68) * (index / (count - 1));
      const x = layout.width / 2 + (count > 2 ? (index % 2 ? 1 : -1) * layout.width * 0.05 : 0);
      return [holding.ticker, { x, y }];
    }),
  );
  const theirs = result.guruOnly.slice(0, layout.maxSide);
  const theirsIndex = new Map(theirs.map((holding, index) => [holding.ticker, index]));
  const mine = result.userOnly.slice(0, layout.maxSide);
  const previewList = guru.holdings.slice(0, layout.maxPreview);

  const guruElectrons = guru.holdings.map((holding) => {
    const previewIndex = previewList.findIndex((candidate) => candidate.ticker === holding.ticker);
    const start = previewIndex >= 0 ? previewPosition(layout, previewIndex, previewList.length) : layout.center;
    const startAlpha = previewIndex >= 0 ? 1 : 0;
    if (middle.has(holding.ticker)) {
      const meet = middle.get(holding.ticker);
      const staging = lerpPoint(layout.right, meet, 0.42);
      const p = travel > 0 ? lerpPoint(staging, meet, travel) : lerpPoint(start, staging, settle);
      return { holding, p, kind: 'shared', alpha: lerp(startAlpha, 1, settle) };
    }
    if (theirsIndex.has(holding.ticker)) {
      const offset = sideOffset(layout, theirsIndex.get(holding.ticker), theirs.length, 1);
      const target = { x: layout.right.x + offset.dx, y: layout.right.y + offset.dy };
      return { holding, p: lerpPoint(start, target, settle), kind: 'own', alpha: lerp(startAlpha, 1, settle) };
    }
    return { holding, p: lerpPoint(start, guruNucleus, settle), kind: 'hidden', alpha: startAlpha * (1 - settle) };
  });

  const myElectrons = mine.map((holding, index) => {
    const offset = sideOffset(layout, index, mine.length, -1);
    return { holding, p: { x: myNucleus.x + offset.dx * settle, y: myNucleus.y + offset.dy * settle } };
  });
  const mySharedElectrons = shownShared.map((holding) => {
    const meet = middle.get(holding.ticker);
    const staging = lerpPoint(layout.left, meet, 0.42);
    const now = {
      x: myNucleus.x + (staging.x - layout.left.x) * settle,
      y: myNucleus.y + (staging.y - layout.left.y) * settle,
    };
    return { holding, p: travel > 0 ? lerpPoint(staging, meet, travel) : now, meet };
  });

  // bonds first so electrons sit on top of them
  myElectrons.forEach(({ p }) => paint.sketch(myNucleus, p, colors.ink, 0.55 * settle, layout.rand));
  mySharedElectrons.forEach(({ p }) => paint.sketch(myNucleus, p, colors.ink, 0.6 * settle, layout.rand));
  guruElectrons.forEach(({ p, alpha }) => paint.sketch(guruNucleus, p, colors.guru, 0.58 * alpha, layout.rand));
  paint.nucleus(myNucleus, layout.rand, settle);
  paint.nucleus(guruNucleus, layout.rand, 1);

  myElectrons.forEach(({ holding, p }) => paint.electron(p, layout.size(holding.weight) * settle, 'mine', settle));
  guruElectrons.forEach(({ holding, p, kind, alpha }) => {
    if (kind !== 'shared') paint.electron(p, layout.size(holding.weight), 'guru', alpha);
  });
  const fused = travel >= 1;
  mySharedElectrons.forEach(({ holding, p, meet }) => {
    const guruElectron = guruElectrons.find((candidate) => candidate.holding.ticker === holding.ticker);
    if (!fused) {
      paint.electron(p, layout.size(holding.userWeight) * settle, 'mine', settle);
      paint.electron(guruElectron.p, layout.size(holding.guruWeight), 'guru', guruElectron.alpha);
      return;
    }
    const radius = layout.size(Math.max(holding.userWeight, holding.guruWeight));
    const pop = 1 + 0.35 * Math.sin(Math.PI * clamp01(fuse * 1.6));
    paint.electron(meet, radius * pop, 'both', 1);
    if (fuse < 1) paint.ring(meet, radius * (1 + 2.4 * easeOut(fuse)), 0.85 * (1 - fuse));
  });

  const labelIn = (value) => clamp01((value - 0.6) / 0.4);
  myElectrons.forEach(({ holding, p }) =>
    paint.label(holding.name[lang], percent(holding.weight), p, layout.size(holding.weight) + 3, layout.width, colors.ink, layout.fontSize, labelIn(settle) * 0.95),
  );
  guruElectrons.forEach(({ holding, p, kind }) => {
    const alpha = kind === 'own' ? (settle > 0.6 ? labelIn(settle) : 1 - settle) : 1 - settle * 2;
    paint.label(holding.name[lang], percent(holding.weight), p, layout.size(holding.weight) + 3, layout.width, colors.guru, layout.fontSize, alpha);
  });
  shownShared.forEach((holding) => {
    const meet = middle.get(holding.ticker);
    const radius = layout.size(Math.max(holding.userWeight, holding.guruWeight));
    paint.label(holding.name[lang], `${percent(holding.userWeight)} · ${percent(holding.guruWeight)}`, meet, radius + 3, layout.width, colors.guru, layout.fontSize, fuse);
  });

  const nameSize = layout.narrow ? 14 : 17;
  paint.caption(labels.me, { x: myNucleus.x, y: myNucleus.y + 16 }, colors.ink, nameSize, settle);
  paint.caption(guru.person[lang], { x: guruNucleus.x, y: guruNucleus.y + 16 }, colors.guru, nameSize, 1);
  const moreMine = result.userOnly.length - mine.length;
  const moreTheirs = result.guruOnly.length - theirs.length;
  if (moreMine > 0) paint.caption(`+${moreMine}`, { x: myNucleus.x, y: myNucleus.y + 34 }, colors.ink, layout.fontSize - 2, settle * 0.45);
  if (moreTheirs > 0) paint.caption(`+${moreTheirs}`, { x: guruNucleus.x, y: guruNucleus.y + 34 }, colors.ink, layout.fontSize - 2, settle * 0.45);
  if (result.shared.length > shownShared.length) {
    paint.caption(labels.moreShared(result.shared.length - shownShared.length), { x: layout.width / 2, y: layout.bottom + 2 }, colors.guru, layout.fontSize - 1, fuse);
  }
  if (!result.shared.length) {
    paint.caption(labels.noShared, { x: layout.width / 2, y: layout.cy - 10 }, colors.ink, layout.fontSize + 1, fuse * 0.6);
  }
}
