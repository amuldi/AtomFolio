import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export function createLabelRenderer(width, height) {
  const renderer = new CSS2DRenderer();
  renderer.setSize(width, height);
  renderer.domElement.className = 'atom-webgl-labels';
  return renderer;
}

export function resizeLabelRenderer(renderer, width, height) {
  renderer.setSize(width, height);
}

// One CSS2DObject per atom: a real label div (name + optional return) for sighted users, plus a
// visually-hidden-but-focusable <button> for keyboard selection — both riding the same
// world-position sync CSS2DRenderer already does every frame, so they can't drift apart.
export function createAtomLabelObject(atom, { onKeyboardSelect }) {
  const container = document.createElement('div');
  container.className = 'atom-webgl-label';

  const nameEl = document.createElement('span');
  nameEl.className = 'atom-webgl-label__name';
  nameEl.textContent = atom.label ?? '';
  container.appendChild(nameEl);

  if (atom.detail) {
    const detailEl = document.createElement('span');
    detailEl.className = 'atom-webgl-label__detail';
    detailEl.textContent = atom.detail;
    container.appendChild(detailEl);
  }

  const focusButton = document.createElement('button');
  focusButton.type = 'button';
  focusButton.className = 'atom-webgl-focus-target';
  focusButton.setAttribute('aria-label', atom.label ?? '');
  focusButton.addEventListener('click', () => onKeyboardSelect(atom.id));
  container.appendChild(focusButton);

  const object = new CSS2DObject(container);
  object.userData.atomId = atom.id;
  return object;
}

export function setAtomLabelSelected(labelObject, isSelected) {
  labelObject.element.classList.toggle('is-selected', isSelected);
  const button = labelObject.element.querySelector('.atom-webgl-focus-target');
  if (button) {
    button.setAttribute('aria-pressed', String(isSelected));
  }
}

// Distant "other portfolio" preview label — just a name, no return value, plus the same
// visually-hidden-but-focusable button pattern for keyboard access as the main atom labels.
export function createPortfolioPreviewLabelObject(entry, { onSelect }) {
  const container = document.createElement('div');
  container.className = 'atom-webgl-preview-label';

  const nameEl = document.createElement('span');
  nameEl.className = 'atom-webgl-preview-label__name';
  nameEl.textContent = entry.fileName ?? '';
  container.appendChild(nameEl);

  const focusButton = document.createElement('button');
  focusButton.type = 'button';
  focusButton.className = 'atom-webgl-focus-target';
  focusButton.setAttribute('aria-label', entry.fileName ?? '');
  focusButton.addEventListener('click', () => onSelect(entry.id));
  container.appendChild(focusButton);

  const object = new CSS2DObject(container);
  object.userData.entryId = entry.id;
  return object;
}
