import logoUrl from './assets/medisafe-logo.png';
/** Small inline SVG icon set (original, no dependency). Decorative: always paired with a text label. */
const PATHS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  building: 'M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M8 8h3M8 12h3M8 16h3',
  alert: 'M12 3 2.5 20h19L12 3zM12 10v4M12 17h.01',
  message: 'M4 5h16v11H8l-4 4V5zM8 9h8M8 12h5',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12l2 2 4-4',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3zM9 12l2 2 4-4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  gauge: 'M4 16a8 8 0 1 1 16 0M12 16l4-5M12 16h.01',
  history: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8z',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7 18a1.5 1.5 0 1 0 0 .01M17 18a1.5 1.5 0 1 0 0 .01',
  package: 'M12 3 4 7v10l8 4 8-4V7l-8-4zM4 7l8 4 8-4M12 11v10',
  check: 'M5 12l4 4 10-10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
};

export function Icon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name] || PATHS.grid}/></svg>;
}

/** MediSafe Chain logo mark (shield, capsule and linked blocks). Decorative: the brand name is always shown as text next to it. */
export function LogoMark({ size = 40 }) {
  return <img className="c3-logo-mark" src={logoUrl} width={size} height={size} alt="" aria-hidden="true" decoding="async"/>;
}
