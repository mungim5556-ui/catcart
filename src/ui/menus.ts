import type { CatCharacter } from '../kart/catKart';
import { TRACKS } from '../world/trackDefs';
import { loadRecords, formatTime } from '../race/raceSession';
import { trackPreview } from './trackPreview';

export interface Difficulty {
  label: string;
  cc: string;
  /** Multiplies every rival's pace. */
  aiPace: number;
  /** How strongly AI ahead of the player eases off. */
  catchUpAhead: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { label: '쉬움', cc: '50cc', aiPace: 0.93, catchUpAhead: 0.0016 },
  { label: '보통', cc: '100cc', aiPace: 1, catchUpAhead: 0.0011 },
  { label: '어려움', cc: '150cc', aiPace: 1.045, catchUpAhead: 0.0006 },
];

export type Screen = 'title' | 'controls' | 'select' | 'track' | 'pause' | 'none';
export type RaceMode = 'single' | 'cup';

export interface MenuHandlers {
  /** Cat highlighted on the select screen changed (live preview). */
  onPreview(catIndex: number): void;
  /** Track highlighted on the track screen changed (backdrop preview). */
  onPreviewTrack(trackIndex: number): void;
  /** Single race on `trackIndex`, or a cup (which starts on track 0). */
  onStart(catIndex: number, difficulty: Difficulty, mode: RaceMode, trackIndex: number): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  /** Flip sound on/off; returns the new state. */
  onToggleSound(): boolean;
  soundOn(): boolean;
  /** UI feedback sound. */
  onSound(kind: 'move' | 'select'): void;
}

const PREFS_KEY = 'catcart.prefs.v1';
export const CUP_NAME = '냥냥컵';
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

function loadPrefs(): { cat: number; diff: number; track: number } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { cat: p.cat ?? 0, diff: p.diff ?? 1, track: p.track ?? 0 };
  } catch {
    return { cat: 0, diff: 1, track: 0 };
  }
}

/** DOM menus with mouse and keyboard navigation. */
export class Menus {
  screen: Screen = 'none';
  cat: number;
  diff: number;
  track: number;
  mode: RaceMode = 'single';
  private root = document.getElementById('menus')!;
  private focus = 0;

  constructor(
    private roster: CatCharacter[],
    private h: MenuHandlers,
  ) {
    const prefs = loadPrefs();
    this.cat = Math.min(prefs.cat, roster.length - 1);
    this.diff = Math.min(prefs.diff, DIFFICULTIES.length - 1);
    this.track = Math.min(prefs.track, TRACKS.length - 1);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (el) this.act(el.dataset.action!);
    });
  }

  show(screen: Screen): void {
    this.screen = screen;
    this.focus = 0;
    this.render();
  }

  /** Keyboard navigation. Returns true if the key was used. */
  key(code: string): boolean {
    if (this.screen === 'none') return false;
    const buttons = this.buttons();
    const before = `${this.focus}/${this.cat}/${this.diff}/${this.track}`;
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        if (this.screen === 'select') this.setDiff(this.diff - 1);
        else if (this.screen === 'track') this.setTrack(this.track - 1);
        else this.focus = (this.focus + buttons.length - 1) % buttons.length;
        break;
      case 'ArrowDown':
      case 'KeyS':
        if (this.screen === 'select') this.setDiff(this.diff + 1);
        else if (this.screen === 'track') this.setTrack(this.track + 1);
        else this.focus = (this.focus + 1) % buttons.length;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        if (this.screen === 'select') this.setCat(this.cat - 1);
        else if (this.screen === 'track') this.setTrack(this.track - 1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        if (this.screen === 'select') this.setCat(this.cat + 1);
        else if (this.screen === 'track') this.setTrack(this.track + 1);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        this.act(this.screen === 'select' ? 'next' : this.screen === 'track' ? 'start' : buttons[this.focus].action);
        return true;
      case 'Escape':
      case 'KeyP':
        if (this.screen === 'pause') this.act('resume');
        else if (this.screen === 'track') this.act('select');
        else if (this.screen === 'select' || this.screen === 'controls') this.act('title');
        else return false;
        return true;
      default:
        return false;
    }
    if (`${this.focus}/${this.cat}/${this.diff}/${this.track}` !== before) this.h.onSound('move');
    this.render();
    return true;
  }

  private buttons(): { label: string; action: string }[] {
    switch (this.screen) {
      case 'title':
        return [
          { label: '🏁 레이스', action: 'single' },
          { label: `🏆 ${CUP_NAME} (트랙 3개)`, action: 'cup' },
          { label: '🎮 조작법', action: 'controls' },
          this.soundButton(),
        ];
      case 'controls':
        return [{ label: '← 돌아가기', action: 'title' }];
      case 'pause':
        return [
          { label: '▶ 계속하기', action: 'resume' },
          { label: '↻ 다시 시작', action: 'restart' },
          { label: '🏠 메인 메뉴', action: 'quit' },
          this.soundButton(),
        ];
      default:
        return [];
    }
  }

  private act(action: string): void {
    this.h.onSound('select');
    if (action.startsWith('cat:')) return this.setCat(+action.slice(4));
    if (action.startsWith('diff:')) return this.setDiff(+action.slice(5));
    if (action.startsWith('track:')) return this.setTrack(+action.slice(6));
    switch (action) {
      case 'title':
      case 'controls':
        return this.show(action);
      case 'single':
      case 'cup':
        this.mode = action;
        return this.act('select');
      case 'select':
        this.show('select');
        this.h.onPreview(this.cat);
        return;
      case 'next':
        // Cup: straight to the race; single race: pick a track first.
        if (this.mode === 'cup') return this.act('start');
        this.show('track');
        this.h.onPreviewTrack(this.track);
        return;
      case 'prev':
        return this.setCat(this.cat - 1);
      case 'nextCat':
        return this.setCat(this.cat + 1);
      case 'start':
        this.savePrefs();
        this.show('none');
        return this.h.onStart(this.cat, DIFFICULTIES[this.diff], this.mode, this.mode === 'cup' ? 0 : this.track);
      case 'resume':
        this.show('none');
        return this.h.onResume();
      case 'restart':
        this.show('none');
        return this.h.onRestart();
      case 'quit':
        return this.h.onQuit();
      case 'sound':
        this.h.onToggleSound();
        return this.render();
    }
  }

  private soundButton(): { label: string; action: string } {
    return { label: this.h.soundOn() ? '🔊 소리 켜짐 (M)' : '🔇 소리 꺼짐 (M)', action: 'sound' };
  }

  /** Re-draw (e.g. after the sound was toggled with the M key). */
  refresh(): void {
    if (this.screen !== 'none') this.render();
  }

  private setCat(i: number): void {
    const n = this.roster.length;
    this.cat = (i + n) % n;
    this.h.onPreview(this.cat);
    this.render();
  }

  private setTrack(i: number): void {
    const n = TRACKS.length;
    this.track = (i + n) % n;
    this.h.onPreviewTrack(this.track);
    this.render();
  }

  private setDiff(i: number): void {
    this.diff = Math.max(0, Math.min(DIFFICULTIES.length - 1, i));
    this.render();
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ cat: this.cat, diff: this.diff, track: this.track }));
    } catch {
      /* ignore */
    }
  }

  private render(): void {
    document.body.classList.toggle('in-menu', ['title', 'controls', 'select', 'track'].includes(this.screen));
    this.root.className = this.screen === 'none' ? '' : `show ${this.screen}`;
    const list = (cls = '') =>
      `<div class="menu-buttons ${cls}">${this.buttons()
        .map((b, i) => `<button data-action="${b.action}" class="${i === this.focus ? 'focus' : ''}">${b.label}</button>`)
        .join('')}</div>`;

    switch (this.screen) {
      case 'none':
        this.root.innerHTML = '';
        return;
      case 'title':
        this.root.innerHTML = `
          <div class="title-card">
            <h1 class="logo"><span>🐾</span> CatCart</h1>
            <p class="tagline">귀여운 고양이들의 카트 레이스!</p>
            ${list()}
            <p class="hint"><kbd>↑</kbd><kbd>↓</kbd> 선택 · <kbd>Enter</kbd> 확인</p>
          </div>`;
        return;
      case 'controls':
        this.root.innerHTML = `
          <div class="panel">
            <h2>🎮 조작법</h2>
            <table class="controls">
              <tr><td><kbd>W</kbd> <kbd>↑</kbd></td><td>가속</td></tr>
              <tr><td><kbd>S</kbd> <kbd>↓</kbd></td><td>브레이크 · 후진</td></tr>
              <tr><td><kbd>A</kbd><kbd>D</kbd> <kbd>←</kbd><kbd>→</kbd></td><td>조향</td></tr>
              <tr><td><kbd>Space</kbd> <kbd>Shift</kbd></td><td>누른 채로 꺾으면 드리프트 → 떼면 터보<br/><small>불꽃 <b class="blue">파랑</b> → <b class="orange">주황</b> → <b class="purple">보라</b></small></td></tr>
              <tr><td><kbd>E</kbd> <kbd>Ctrl</kbd></td><td>아이템 사용 🐟 🧶 🍌</td></tr>
              <tr><td><kbd>R</kbd></td><td>도로로 복귀</td></tr>
              <tr><td><kbd>Esc</kbd> <kbd>P</kbd></td><td>일시정지</td></tr>
            </table>
            <p class="tip">🚀 카운트다운 <b>1</b>이 나올 때 가속하면 로켓 스타트!</p>
            ${list()}
          </div>`;
        return;
      case 'select': {
        const c = this.roster[this.cat];
        const dots = this.roster
          .map((r, i) => `<button data-action="cat:${i}" class="dot ${i === this.cat ? 'on' : ''}" style="background:${hex(r.style.kart)}" aria-label="${r.name}"></button>`)
          .join('');
        const diffs = DIFFICULTIES.map(
          (d, i) => `<button data-action="diff:${i}" class="${i === this.diff ? 'on' : ''}">${d.label}<small>${d.cc}</small></button>`,
        ).join('');
        this.root.innerHTML = `
          <h2 class="select-title">고양이 선택</h2>
          <div class="select-bar">
            <div class="cat-pick">
              <button data-action="prev" class="arrow" aria-label="이전">◀</button>
              <div class="cat-name">
                <div class="name" style="color:${hex(c.style.kart)}">${c.name}</div>
                <div class="trait">${c.trait}</div>
                <div class="dots">${dots}</div>
              </div>
              <button data-action="nextCat" class="arrow" aria-label="다음">▶</button>
            </div>
            <div class="diff">${diffs}</div>
            <button data-action="next" class="go">${this.mode === 'cup' ? `${CUP_NAME} 출발! 🏆` : '트랙 고르기 ▶'}</button>
            <p class="hint"><kbd>←</kbd><kbd>→</kbd> 고양이 · <kbd>↑</kbd><kbd>↓</kbd> 난이도 · <kbd>Enter</kbd> 다음 · <kbd>Esc</kbd> 뒤로</p>
          </div>`;
        return;
      }
      case 'track': {
        const cards = TRACKS.map((t, i) => {
          const best = loadRecords(t.id).bestTotal;
          return `<button data-action="track:${i}" class="track-card ${i === this.track ? 'on' : ''}">
              <img src="${trackPreview(t)}" alt="" style="background:#${t.theme.ground[0].toString(16).padStart(6, '0')}" />
              <div class="tname">${t.emoji} ${t.name}</div>
              <div class="tdesc">${t.desc}</div>
              <div class="tbest">최고 기록 ${formatTime(best)}</div>
            </button>`;
        }).join('');
        this.root.innerHTML = `
          <h2 class="select-title">트랙 선택</h2>
          <div class="track-bar">
            <div class="track-cards">${cards}</div>
            <button data-action="start" class="go">출발! 🏁</button>
            <p class="hint"><kbd>←</kbd><kbd>→</kbd> 트랙 · <kbd>Enter</kbd> 출발 · <kbd>Esc</kbd> 뒤로</p>
          </div>`;
        return;
      }
      case 'pause':
        this.root.innerHTML = `
          <div class="panel">
            <h2>⏸ 일시정지</h2>
            ${list()}
          </div>`;
        return;
    }
  }
}
