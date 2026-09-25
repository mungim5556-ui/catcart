/** Everything that makes one track different: shape, placements and look. */

import type { HazardDef } from './hazards';

export type PropKind =
  | 'pine'
  | 'snowPine'
  | 'rock'
  | 'iceRock'
  | 'yarn'
  | 'palm'
  | 'umbrella'
  | 'beachBall'
  | 'sandcastle'
  | 'snowman'
  | 'present'
  // city
  | 'building'
  | 'lamp'
  | 'neon'
  | 'trashcan'
  | 'crate'
  // forest
  | 'broadleaf'
  | 'mushroom'
  | 'stump'
  | 'bush'
  // desert
  | 'cactus'
  | 'sandRock'
  | 'tumbleweed'
  | 'obelisk'
  | 'urn';

/** Big one-off set pieces placed at fixed spots. */
export interface Landmark {
  kind: 'pyramid' | 'sphinx';
  x: number;
  z: number;
  size: number;
  /** Facing (radians around Y). */
  rot?: number;
}

/** Props lined up along both sides of the road (city blocks, forest walls). */
export interface Lining {
  props: [PropKind, number][];
  /** Metres between props along the road. */
  spacing: number;
  /** Distance from the centre line (plus up to `jitter`). */
  offset: number;
  jitter: number;
}

/** What you drive on when you leave the road. */
export interface Offroad {
  label: string; // HUD warning, e.g. '🌱 잔디 — 감속!'
  badge: string; // warning background (CSS colour)
  dust: number; // particles kicked up by the wheels
}

export interface Theme {
  offroad: Offroad;
  sky: number;
  fog: [near: number, far: number];
  hemi: [sky: number, ground: number, intensity: number];
  sun: [color: number, intensity: number];
  ground: [number, number];
  road: number;
  curb: [number, number];
  line: number;
  fence: number;
  arch: number;
  ramp: number;
  /** Sea around the island (beach). */
  water?: number;
  /** Falling snow particles. */
  snow?: boolean;
  /** Night: a light follows the player's kart. */
  night?: boolean;
  /** Scenery on the horizon, beyond the fence. */
  backdrop?: 'mountains' | 'dunes' | 'skyline';
  lining?: Lining;
  /** Scenery mix: kind and relative weight. */
  props: [PropKind, number][];
}

export interface TrackDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** Closed centre-line control points [x, z]; t = 0 is the start line. */
  points: [number, number][];
  /** Positions along the lap (0..1). Pads and ramps belong on straights. */
  pads: number[];
  ramps: [t: number, height: number][];
  boxRows: number[];
  /** Hollow fallen-log tunnels the road runs through (centre t, half length in m). Straights only. */
  tunnels?: [t: number, halfLength: number][];
  landmarks?: Landmark[];
  /** Themed obstacles (see world/hazards.ts). */
  hazards?: HazardDef;
  seed: number;
  theme: Theme;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'meadow',
    name: '냥냥 초원',
    emoji: '🌼',
    desc: '털실 뭉치가 굴러다니는 푸른 초원',
    points: [
      [0, -90], [70, -100], [120, -60], [110, 0], [60, 20], [40, 70], [72, 98], [68, 132],
      [20, 142], [-50, 120], [-80, 70], [-52, 40], [-62, 8], [-100, 0], [-120, -60], [-70, -100],
    ],
    pads: [0.02, 0.18, 0.48, 0.88],
    ramps: [[0.1, 1.4], [0.53, 1.8]],
    boxRows: [0.06, 0.31, 0.58, 0.8],
    hazards: { butterfly: [0.25, 0.84], flower: [0.35, 0.65] },
    seed: 42,
    theme: {
      offroad: { label: '🌱 잔디 — 감속!', badge: 'rgba(60,120,40,.8)', dust: 0x8a9a52 },
      sky: 0xbfe6ff,
      fog: [90, 320],
      hemi: [0xeaf6ff, 0x7cc25c, 1.6],
      sun: [0xfff2dd, 2.2],
      ground: [0x8fd16a, 0x7cc25c],
      road: 0x6b6f80,
      curb: [0xff5a6e, 0xffffff],
      line: 0xfff3b0,
      fence: 0xfff1dc,
      arch: 0xff6f91,
      ramp: 0x57c7ff,
      props: [['pine', 62], ['rock', 20], ['yarn', 18]],
    },
  },
  {
    id: 'beach',
    name: '참치 해변',
    emoji: '🏖️',
    desc: '파도 소리 들리는 모래사장 해안도로',
    points: [
      [0, -115], [75, -118], [128, -85], [135, -25], [100, 15], [112, 70], [75, 122],
      [5, 128], [-45, 98], [-38, 50], [-80, 22], [-128, -15], [-118, -80], [-65, -112],
    ],
    pads: [0.12, 0.47, 0.68, 0.9],
    ramps: [[0.52, 1.8], [0.93, 1.4]],
    boxRows: [0.05, 0.3, 0.6, 0.83],
    hazards: { crab: [0.21, 0.75], beachball: [0.35, 0.645] },
    seed: 7,
    theme: {
      offroad: { label: '🏖️ 모래밭 — 감속!', badge: 'rgba(176,130,60,.85)', dust: 0xe8cf8a },
      sky: 0x9fdcff,
      fog: [110, 360],
      hemi: [0xfff8e8, 0xe8cf8f, 1.7],
      sun: [0xfff0d0, 2.4],
      ground: [0xf3dfa2, 0xe9d08e],
      road: 0x7a7d8c,
      curb: [0x3fb5e8, 0xffffff],
      line: 0xffffff,
      fence: 0xc9a27a,
      arch: 0x3fb5e8,
      ramp: 0xffb300,
      water: 0x46b8e8,
      props: [['palm', 45], ['umbrella', 18], ['beachBall', 12], ['sandcastle', 12], ['rock', 13]],
    },
  },
  {
    id: 'snow',
    name: '눈꽃 마을',
    emoji: '❄️',
    desc: '눈사람이 지켜보는 겨울 산길',
    points: [
      [0, -105], [65, -105], [102, -75], [88, -32], [118, 5], [125, 62], [88, 108], [35, 104],
      [14, 66], [-14, 62], [-36, 96], [-85, 114], [-125, 70], [-108, 12], [-125, -50], [-75, -98],
    ],
    pads: [0.02, 0.26, 0.79, 0.95],
    ramps: [[0.33, 1.6], [0.88, 1.4]],
    boxRows: [0.1, 0.4, 0.62, 0.84],
    hazards: { snowball: [0.46, 0.7], penguin: [0.13, 0.51] },
    seed: 99,
    theme: {
      offroad: { label: '❄️ 눈밭 — 감속!', badge: 'rgba(70,110,160,.8)', dust: 0xffffff },
      sky: 0xd8e8f5,
      fog: [60, 260],
      hemi: [0xf4f8ff, 0xb9c9dd, 1.7],
      sun: [0xfff6ee, 1.9],
      ground: [0xf4f7fb, 0xe3ebf4],
      road: 0x5f6475,
      curb: [0xd64a5a, 0xffffff],
      line: 0xcfe8ff,
      fence: 0x9b6b43,
      arch: 0x7a5cff,
      ramp: 0x9ad0ff,
      snow: true,
      props: [['snowPine', 55], ['snowman', 14], ['iceRock', 14], ['present', 9], ['yarn', 8]],
    },
  },
  {
    id: 'alley',
    name: '달빛 골목',
    emoji: '🌃',
    desc: '네온사인 반짝이는 밤의 뒷골목',
    points: [
      [0, -110], [70, -110], [105, -95], [115, -60], [112, -15], [80, 0], [45, 5], [35, 35], [45, 70], [80, 80],
      [110, 95], [115, 125], [80, 140], [20, 138], [-30, 135], [-70, 125], [-90, 95], [-95, 50], [-110, 20],
      [-125, -20], [-120, -70], [-95, -100], [-50, -110],
    ],
    pads: [0.03, 0.15, 0.5, 0.75],
    ramps: [[0.56, 1.6], [0.95, 1.4]],
    boxRows: [0.1, 0.38, 0.66, 0.84],
    hazards: { vacuum: [0.22, 0.61], steam: [0.45, 0.89] },
    seed: 21,
    theme: {
      offroad: { label: '🚧 인도 — 감속!', badge: 'rgba(60,50,90,.85)', dust: 0x8a8698 },
      sky: 0x1b1838,
      fog: [70, 300],
      hemi: [0x7a76c0, 0x2a2438, 1.25],
      sun: [0xaab8ff, 1.1],
      ground: [0x3a3846, 0x34323f],
      road: 0x4a4a5c,
      curb: [0xffcc33, 0x3a3846],
      line: 0xffd84d,
      fence: 0x4a4458,
      arch: 0xff4fa3,
      ramp: 0xff4fa3,
      night: true,
      backdrop: 'skyline',
      lining: { props: [['building', 70], ['lamp', 12], ['neon', 10], ['trashcan', 8]], spacing: 13, offset: 19, jitter: 3 },
      props: [['building', 40], ['crate', 20], ['trashcan', 15], ['lamp', 15], ['neon', 10]],
    },
  },
  {
    id: 'forest',
    name: '도토리 숲길',
    emoji: '🌲',
    desc: '쓰러진 거목 속을 달리는 숲속 산길',
    points: [
      [0, -110], [60, -108], [100, -80], [95, -40], [62, -18], [58, 22], [92, 42], [122, 78], [100, 118],
      [50, 126], [15, 110], [-22, 124], [-68, 128], [-108, 105], [-112, 55], [-112, 15], [-88, -15],
      [-88, -50], [-115, -78], [-100, -108], [-50, -114],
    ],
    pads: [0.02, 0.545, 0.652, 0.915],
    ramps: [[0.945, 1.4]],
    boxRows: [0.12, 0.35, 0.6, 0.8],
    hazards: { hedgehog: [0.2, 0.76], mushroom: [0.5, 0.85] },
    tunnels: [[0.69, 13]],
    seed: 5,
    theme: {
      offroad: { label: '🌿 수풀 — 감속!', badge: 'rgba(50,90,40,.85)', dust: 0x6b5a3a },
      sky: 0xa9d6c9,
      fog: [80, 420],
      hemi: [0xe8f5e0, 0x4f7a3a, 1.5],
      sun: [0xfff0c8, 2.0],
      ground: [0x5f8f3e, 0x557f36],
      road: 0x9a7a58,
      curb: [0x6b4f3a, 0xa8865f],
      line: 0x9a7a58,
      fence: 0x6b4f3a,
      arch: 0x8b5a2b,
      ramp: 0xa0703f,
      backdrop: 'mountains',
      lining: { props: [['pine', 45], ['broadleaf', 35], ['bush', 20]], spacing: 9, offset: 15, jitter: 6 },
      props: [['pine', 28], ['broadleaf', 24], ['mushroom', 12], ['stump', 10], ['rock', 10], ['bush', 16]],
    },
  },
  {
    id: 'desert',
    name: '모래바람 사막',
    emoji: '🏜️',
    desc: '고양이 스핑크스와 피라미드의 사막',
    points: [
      [0, -120], [80, -120], [130, -90], [135, -30], [110, 20], [125, 70], [100, 120], [40, 130],
      [-10, 105], [-60, 125], [-110, 110], [-130, 60], [-105, 10], [-130, -40], [-115, -95], [-60, -122],
    ],
    pads: [0.03, 0.17, 0.41, 0.89],
    ramps: [[0.1, 1.8], [0.44, 1.6]],
    boxRows: [0.07, 0.3, 0.6, 0.8],
    hazards: { dustdevil: [0.21, 0.36], cactus: [0.515, 0.75] },
    landmarks: [
      { kind: 'pyramid', x: 15, z: -5, size: 56 },
      { kind: 'pyramid', x: -50, z: 45, size: 36 },
      { kind: 'pyramid', x: 50, z: 50, size: 24 },
      // Faces the start/finish straight so you see its face every lap.
      { kind: 'sphinx', x: -40, z: -55, size: 1, rot: 2.84 },
    ],
    seed: 13,
    theme: {
      offroad: { label: '🏜️ 모래언덕 — 감속!', badge: 'rgba(190,140,60,.85)', dust: 0xe9c27a },
      sky: 0xf6d7a4,
      fog: [130, 420],
      hemi: [0xfff1d6, 0xd9a860, 1.7],
      sun: [0xffe0b0, 2.6],
      ground: [0xe9c27a, 0xdcb068],
      road: 0x9a8570,
      curb: [0xd9534f, 0xf5e6c8],
      line: 0xfff3d0,
      fence: 0xc9955a,
      arch: 0xd9a441,
      ramp: 0xd9534f,
      backdrop: 'dunes',
      props: [['cactus', 35], ['sandRock', 22], ['tumbleweed', 15], ['urn', 12], ['obelisk', 6], ['palm', 10]],
    },
  },
];

/** Cups: three tracks each, raced in order. */
export const CUPS = [
  { id: 'nyang', name: '냥냥컵', emoji: '🏆', tracks: ['meadow', 'beach', 'snow'] },
  { id: 'yaong', name: '야옹컵', emoji: '🌙', tracks: ['alley', 'forest', 'desert'] },
];
