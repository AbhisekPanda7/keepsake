/**
 * The looks an album can have. A theme is three independent choices, and an album
 * stores only their ids, so a look can be refined later without touching stored data.
 * Pure data, no rendering.
 */

export const COVER_COLOURS = {
  walnut: { name: 'Walnut', rgb: [74, 44, 26], foil: '#c9a45c', css: '#4a2c1a', ribbon: '#6a1f1c', endpaper: '#5d3a24' },
  burgundy: { name: 'Burgundy', rgb: [96, 26, 34], foil: '#d0ab62', css: '#601a22', ribbon: '#c2a15e', endpaper: '#4f1a20' },
  forest: { name: 'Forest', rgb: [34, 60, 46], foil: '#c9a45c', css: '#223c2e', ribbon: '#7a2a22', endpaper: '#25392c' },
  midnight: { name: 'Midnight', rgb: [28, 38, 66], foil: '#cfd3d8', css: '#1c2642', ribbon: '#9aa3b2', endpaper: '#222c47' },
  graphite: { name: 'Graphite', rgb: [44, 42, 42], foil: '#cfd3d8', css: '#2c2a2a', ribbon: '#8d2f2a', endpaper: '#343232' },
  sand: { name: 'Sand', rgb: [178, 154, 120], foil: '#4a2f1c', css: '#b29a78', ribbon: '#5a3a24', endpaper: '#8d7555' },
};

export const COVER_MATERIALS = {
  leather: { name: 'Leather', roughness: 0.68, bumpScale: 0.7 },
  linen: { name: 'Book linen', roughness: 0.88, bumpScale: 0.45 },
};

/** `linear` is the paper in linear light, which the page shader divides by. */
export const PAPERS = {
  ivory: {
    name: 'Warm ivory',
    rgb: [242, 233, 214],
    ink: '#5b4630',
    inkSoft: 'rgba(91,70,48,0.62)',
    faint: '112,84,50',
    gutter: '70,46,22',
    mount: '#6d4c2d',
    print: '#fbf7ee',
    edge: '#e9dfc9',
    linear: [0.88, 0.8, 0.66],
  },
  white: {
    name: 'Bright white',
    rgb: [247, 245, 240],
    ink: '#46423c',
    inkSoft: 'rgba(70,66,60,0.62)',
    faint: '90,86,78',
    gutter: '58,54,48',
    mount: '#3f3a35',
    print: '#ffffff',
    edge: '#efece5',
    linear: [0.93, 0.91, 0.87],
  },
  kraft: {
    name: 'Kraft',
    rgb: [193, 165, 126],
    ink: '#3d2a18',
    inkSoft: 'rgba(61,42,24,0.72)',
    faint: '70,48,26',
    gutter: '60,38,16',
    mount: '#3d2a18',
    print: '#f6f1e6',
    edge: '#b89c76',
    linear: [0.53, 0.38, 0.21],
  },
  black: {
    name: 'Black card',
    rgb: [38, 36, 35],
    ink: '#e0d8c6',
    inkSoft: 'rgba(224,216,198,0.66)',
    faint: '224,216,198',
    gutter: '0,0,0',
    mount: '#a08a5e',
    print: '#f4efe4',
    edge: '#2e2c2a',
    linear: [0.02, 0.018, 0.017],
  },
};

export const DEFAULT_THEME = Object.freeze({ colour: 'walnut', material: 'leather', paper: 'ivory' });

const pick = (table, id, fallback) => (Object.hasOwn(table, id ?? '') ? id : fallback);

/** A stored theme with anything unknown or missing replaced by the default. */
export function normalizeTheme(theme) {
  return {
    colour: pick(COVER_COLOURS, theme?.colour, DEFAULT_THEME.colour),
    material: pick(COVER_MATERIALS, theme?.material, DEFAULT_THEME.material),
    paper: pick(PAPERS, theme?.paper, DEFAULT_THEME.paper),
  };
}

/** Everything rendering needs, looked up from a stored theme. */
export function resolveTheme(theme) {
  const ids = normalizeTheme(theme);
  return {
    ...ids,
    key: `${ids.colour}-${ids.material}-${ids.paper}`,
    colourInfo: COVER_COLOURS[ids.colour],
    materialInfo: COVER_MATERIALS[ids.material],
    paperInfo: PAPERS[ids.paper],
  };
}

/** Starting suggestions on the creation screen, so a new album is one tap from good. */
export const THEME_PRESETS = [
  { name: 'Heirloom', theme: { colour: 'walnut', material: 'leather', paper: 'ivory' } },
  { name: 'Wedding', theme: { colour: 'burgundy', material: 'leather', paper: 'white' } },
  { name: 'Travels', theme: { colour: 'sand', material: 'linen', paper: 'kraft' } },
  { name: 'Gallery', theme: { colour: 'graphite', material: 'linen', paper: 'black' } },
];
