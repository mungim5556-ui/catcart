import { ITEM_ICON, type ItemHolder } from '../items/items';

const ICONS = [...new Set(Object.values(ITEM_ICON))];

/** Item slot: spins through icons during the roulette, then shows the item (and uses left). */
export class ItemHud {
  private box = document.getElementById('item')!;
  private icon = document.getElementById('item-icon')!;
  private count = document.getElementById('item-count')!;
  /** Mirror on the touch item button. */
  private touchIcon = document.getElementById('t-item-icon');
  private shown = '';
  private tick = 0;

  update(h: ItemHolder, dt: number): void {
    if (h.roulette > 0) {
      this.tick += dt;
      this.icon.textContent = ICONS[Math.floor(this.tick * 14) % ICONS.length];
      this.icon.className = 'spin';
      this.count.textContent = '';
      this.shown = 'spin';
    } else {
      const key = h.item ? `${h.item}:${h.itemUses}` : '';
      if (key !== this.shown) {
        this.icon.textContent = h.item ? ITEM_ICON[h.item] : '';
        this.count.textContent = h.item && h.itemUses > 1 ? `×${h.itemUses}` : '';
        this.icon.className = '';
        if (h.item) {
          void this.icon.offsetWidth;
          this.icon.className = 'got';
        }
        this.shown = key;
      }
    }
    this.box.classList.toggle('ready', !!h.item && h.roulette <= 0);
    if (this.touchIcon) this.touchIcon.textContent = (this.icon.textContent || '🎁') + (this.count.textContent ? ' ' + this.count.textContent : '');
  }
}
