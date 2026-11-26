/**
 * Pictures for Mojave's tiles on the row: the inside of a 40 by 40 SVG, drawn
 * in lines as the shared tools' are (the row gives them their stroke and fill).
 */
export const ICONS: Readonly<Record<string, string>> = {
  // The row's own.
  command: '<path d="M20 5 33 11v9c0 8-6 13-13 15C13 33 7 28 7 20v-9Z"/><path d="M20 12l2.4 5h5.4l-4.3 3.4 1.6 5.4-5.1-3.2-5.1 3.2 1.6-5.4-4.3-3.4h5.4Z"/>',
  build: '<path d="M6 33h28M9 33V18l11-8 11 8v15"/><path d="M16 33v-9h8v9"/>',
  army: '<circle cx="12" cy="13" r="3.5"/><circle cx="28" cy="13" r="3.5"/><circle cx="20" cy="10" r="3.5"/><path d="M6 31v-6c0-3 3-5 6-5M34 31v-6c0-3-3-5-6-5M13 33v-8c0-4 3-6 7-6s7 2 7 6v8"/>',
  idle: '<rect x="6" y="17" width="20" height="11" rx="2"/><path d="M26 20h6l3 4v4h-9"/><circle cx="12" cy="30" r="3"/><circle cx="29" cy="30" r="3"/><path d="M24 6h8l-8 7h8"/>',
  map: '<path d="M5 9l10-3 10 3 10-3v25l-10 3-10-3-10 3Z"/><path d="M15 6v25M25 9v25"/>',
  back: '<path d="M17 10 7 20l10 10M7 20h20c4 0 6 3 6 7"/>',
  cancel: '<circle cx="20" cy="20" r="13"/><path d="M14 14l12 12M26 14 14 26"/>',
  more: '<path d="M8 26l12-12 12 12"/><path d="M8 33h24"/>',
  less: '<path d="M8 14l12 12 12-12"/><path d="M8 7h24"/>',
  // Orders.
  move: '<path d="M20 5v30M5 20h30M20 5l-5 6M20 5l5 6M20 35l-5-6M20 35l5-6M5 20l6-5M5 20l6 5M35 20l-6-5M35 20l-6 5"/>',
  amove: '<circle cx="20" cy="20" r="12"/><circle cx="20" cy="20" r="4"/><path d="M20 4v8M20 28v8M4 20h8M28 20h8"/>',
  stop: '<path d="M14 6h12l8 8v12l-8 8H14l-8-8V14Z"/><path d="M14 20h12"/>',
  hold: '<path d="M20 5 33 10v10c0 8-6 13-13 15C13 33 7 28 7 20V10Z"/><path d="M14 20h12M20 14v12"/>',
  patrol: '<path d="M8 14h20l-5-5M32 26H12l5 5"/><path d="M28 14l-5 5M12 26l5-5"/>',
  gather: '<path d="M20 6l8 9-4 15h-8l-4-15Z"/><path d="M12 15h16M20 6v24M8 34h24"/>',
  return: '<path d="M6 33h28M9 33V17l11-8 11 8v16"/><path d="M26 22H15M19 17l-5 5 5 5"/>',
  unload: '<path d="M6 12h28v10H6Z"/><path d="M20 22v12M14 29l6 6 6-6"/>',
  emp: '<circle cx="20" cy="20" r="4"/><circle cx="20" cy="20" r="10"/><path d="M20 3v5M20 32v5M3 20h5M32 20h5"/><path d="M22 14l-5 7h6l-5 7"/>',
  rally: '<path d="M11 35V6"/><path d="M11 7h19l-5 7 5 7H11"/>',
  // Buildings.
  core: '<path d="M5 33h30M8 33V19h24v14M13 19v-7h14v7M20 12V5"/><circle cx="20" cy="5" r="1.5"/><path d="M17 33v-7h6v7"/>',
  tap: '<path d="M14 34V15h12v19M10 34h20M11 15h18"/><path d="M20 11c-3-3 3-4 0-8"/>',
  relay: '<path d="M20 34V11M13 34h14M20 11l-6 23M20 11l6 23"/><path d="M12 9a11 11 0 0 1 16 0M15.5 12.5a6 6 0 0 1 9 0"/>',
  foundry: '<path d="M5 33h30M7 33V17l8 5v-5l8 5v-5l8 5v11"/><path d="M27 17V7h4v12"/>',
  armory: '<path d="M5 33h30M8 33V15h24v18"/><path d="M8 15l12-8 12 8"/><path d="M15 21l10 8M25 21l-10 8"/>',
  skyport: '<path d="M5 33h30"/><circle cx="20" cy="25" r="8"/><path d="M15 25h10M20 20v10"/><path d="M12 12h16M20 12v5"/>',
  titanbay: '<path d="M5 34h30M8 34V8h24v26"/><path d="M14 34V16h12v18M14 22h12"/>',
  sentry: '<path d="M10 34h20M14 34V22h12v12"/><rect x="11" y="13" width="14" height="9" rx="2"/><path d="M25 17h10"/>',
  flak: '<path d="M10 34h20M15 34V24h10v10"/><path d="M17 24 12 8M23 24l5-16M12 8l3-1M28 8l-3-1"/>',
  laser: '<path d="M10 34h20M16 34V20h8v14"/><circle cx="20" cy="14" r="6"/><path d="M20 8V3M26 14h8"/>',
  // Units.
  hauler: '<rect x="5" y="15" width="21" height="12" rx="2"/><path d="M26 19h6l3 4v4h-9"/><circle cx="11" cy="29" r="3.5"/><circle cx="29" cy="29" r="3.5"/>',
  trooper: '<circle cx="18" cy="9" r="4.5"/><path d="M12 34V22c0-4 2-6 6-6s6 2 6 6v12M18 24v10"/><path d="M22 20l12-7M30 12l3 5"/>',
  scout: '<path d="M6 25l5-9h14l9 6v5H6Z"/><circle cx="12" cy="29" r="4"/><circle cx="28" cy="29" r="4"/><path d="M17 16v-6"/>',
  tank: '<rect x="4" y="23" width="32" height="9" rx="4.5"/><path d="M10 23v-6h15v6"/><path d="M25 19h12"/>',
  artillery: '<rect x="5" y="25" width="26" height="8" rx="4"/><path d="M11 25l4-6h8l3 6"/><path d="M19 19 34 6"/>',
  missile: '<rect x="4" y="24" width="30" height="8" rx="3"/><path d="M8 24l20-12 3 4-14 8"/><path d="M28 12l4-5"/>',
  gunship: '<path d="M6 12h28M20 12v5"/><path d="M11 17h18l5 6-5 6H11l-4-6Z"/><path d="M15 29v4M25 29v4"/>',
  transport: '<path d="M4 11h12M24 11h12M10 11v5M30 11v5"/><rect x="7" y="16" width="26" height="14" rx="3"/><path d="M14 30v4M26 30v4"/>',
  emp_unit: '<path d="M6 12h28M20 12v5"/><circle cx="20" cy="24" r="8"/><path d="M22 19l-4 5h5l-4 5"/>',
  titan: '<rect x="12" y="6" width="16" height="13" rx="2"/><path d="M15 19l-3 8 2 8M25 19l3 8-2 8M12 12H5M28 12h7M10 35h8M22 35h8"/>',
  // Upgrades.
  weapons: '<path d="M8 32 28 12M24 8l8 8M8 32l-3 3M12 28l4 4"/><path d="M28 12l3-7"/>',
  armour: '<path d="M20 5 33 10v10c0 8-6 13-13 15C13 33 7 28 7 20V10Z"/><path d="M20 11v19M13 17h14"/>',
};
