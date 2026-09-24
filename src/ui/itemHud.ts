import { ITEM_ICON, type ItemHolder, type ItemKind } from '../items/items';

const ICONS = Object.values(ITEM_ICON);

/** Item slot: spins through icons during the roulette, then shows the item. */
export class ItemHud {
  private box = document.getElementById('item')!;
  private icon = document.getElementById('item-icon')!;
  private shown: ItemKind | null | 'spin' = null;
  private tick = 0;

  update(h: ItemHolder, dt: number): void {
    if (h.roulette > 0) {
      this.tick += dt;
      this.icon.textContent = ICONS[Math.floor(this.tick * 14) % ICONS.length];
      this.icon.className = 'spin';
      this.shown = 'spin';
    } else if (h.item !== this.shown) {
      this.icon.textContent = h.item ? ITEM_ICON[h.item] : '';
      this.icon.className = '';
      if (h.item) {
        void this.icon.offsetWidth;
        this.icon.className = 'got';
      }
      this.shown = h.item;
    }
    this.box.classList.toggle('ready', !!h.item && h.roulette <= 0);
  }
}
