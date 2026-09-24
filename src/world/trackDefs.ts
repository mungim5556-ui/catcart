/** Everything that makes one track different: shape, placements and look. */

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
  | 'present';

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
];
