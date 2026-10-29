/** CSS for the web subtitle overlay from a SubtitleStyle (pure; tested). */
import type { SubtitleStyle } from '../GlideEngine.types';

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  scale: 1,
  font: 'sans',
  bold: false,
  color: '#FFFFFF',
  background: 'none',
  backgroundColor: '#000000',
  backgroundOpacity: 0.5,
  edge: 'outline',
  edgeColor: '#000000',
  position: 0.08,
  useFileStyles: true,
};

const FONTS: Record<SubtitleStyle['font'], string> = {
  sans: 'Barlow, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  condensed: '"Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif',
  casual: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive',
};

/** #RRGGBB + opacity → rgba(). */
export function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function textShadow(edge: SubtitleStyle['edge'], c: string): string {
  switch (edge) {
    case 'outline':
      return `-1.5px -1.5px 0 ${c}, 1.5px -1.5px 0 ${c}, -1.5px 1.5px 0 ${c}, 1.5px 1.5px 0 ${c}, 0 0 3px ${c}`;
    case 'shadow':
      return `2px 2px 3px ${c}`;
    case 'raised':
      return `1px 1px 0 ${c}, 2px 2px 0 ${c}`;
    case 'depressed':
      return `-1px -1px 0 ${c}, -2px -2px 0 ${c}`;
    default:
      return 'none';
  }
}

/** Styles for the overlay box (positioning, band) and the text span (font, colour, box). */
export function subtitleCss(s: SubtitleStyle): { box: Partial<CSSStyleDeclaration>; text: Partial<CSSStyleDeclaration> } {
  const bg = rgba(s.backgroundColor, s.backgroundOpacity);
  const size = Math.min(3, Math.max(0.4, s.scale));
  return {
    box: {
      bottom: `${Math.round(Math.min(0.45, Math.max(0, s.position)) * 1000) / 10}%`,
      background: s.background === 'band' ? bg : 'transparent',
      padding: s.background === 'band' ? '0.25em 0' : '0',
      fontSize: `calc(clamp(16px, 4.6vmin, 40px) * ${size})`,
    },
    text: {
      fontFamily: FONTS[s.font] ?? FONTS.sans,
      fontWeight: s.bold ? '700' : '500',
      color: s.color,
      background: s.background === 'box' ? bg : 'transparent',
      padding: s.background === 'box' ? '0.1em 0.35em' : '0',
      textShadow: textShadow(s.edge, s.edgeColor),
    },
  };
}
