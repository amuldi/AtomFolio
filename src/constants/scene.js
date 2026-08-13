export const VIEWBOX_SIZE = 640;
export const VIEWBOX_HALF = VIEWBOX_SIZE / 2;
export const MIN_ATOMS = 1;
export const BOND_LENGTH = 214;
export const CAMERA_DISTANCE = 470;
export const CAMERA_NEAR_CLIP = 136;
export const TRACKBALL_RADIUS = 208;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Desktop-widget-only: src/App.jsx (the web app) keeps its own separate, hardcoded
// AUTO_ROTATE_SPEED = 0.018 rather than importing this one, so raising this value only speeds up
// the menu bar widget's idle auto-rotate (desktop/src/renderer/atom-view.jsx imports it directly)
// — the website's own rotation is untouched. Bumped modestly (0.018 -> 0.022, ~22%) per a "just a
// bit faster" request; nudge further if it still reads as too slow/fast once seen running.
export const AUTO_ROTATE_SPEED = 0.022;

export const DEFAULT_SCENE_CAMERA = {
  panX: 0,
  panY: 0,
  dolly: 0,
  zoom: 1,
  roll: 0,
  driftX: 0,
  driftY: 0,
  focus: 0,
};

export const LOW_COUNT_LAYOUTS = {
  2: [
    [0.82, 0.12, 0.56],
    [-0.74, -0.24, -0.63],
  ],
  3: [
    [0.86, 0.08, 0.5],
    [-0.42, 0.82, -0.38],
    [-0.48, -0.8, -0.36],
  ],
  4: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ],
  5: [
    [0, 1, 0.46],
    [0.92, 0.1, -0.34],
    [-0.58, 0.72, -0.38],
    [-0.72, -0.58, -0.36],
    [0.62, -0.76, 0.1],
  ],
};
