export const PRICING_VERSION = 'official-usd-2026-11-17-discount20-v1';
export const discounted = price => Math.round(Math.round(price * 100) * 0.8) / 100;
export const referencePrices = {
  robux: [[1000, 9.99], [1500, 14.99], [2000, 19.99], [3625, 34.99], [5250, 49.99], [11000, 99.99], [24000, 199.99]],
  diamond: [[100, 0.99], [310, 2.99], [520, 4.99], [1060, 9.99], [2180, 19.99], [5600, 49.99]],
};
export const catalog = Object.fromEntries(Object.entries(referencePrices).map(([type, rows]) => [type, rows.map(([amount, oldPrice]) => ({ amount, oldPrice, price: discounted(oldPrice), badge: '' }))]));
