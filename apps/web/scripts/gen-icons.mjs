// Regenerate apps/web/src/components/ui/Icon.tsx with the full Phosphor set the
// design uses. Fetches regular-weight SVGs from jsDelivr and inlines their path
// data as static strings (no runtime CDN dependency).
import { writeFileSync } from 'node:fs';

const NAMES = [
  'arrow-clockwise','arrow-left','arrow-right','arrow-square-out','arrows-clockwise',
  'arrows-split','bell','bell-ringing','bell-slash','broadcast','caret-right',
  'caret-up-down','check','check-circle','checks','circle-notch','clock',
  'clock-counter-clockwise','columns','copy','cube','database','discord-logo',
  'envelope-simple','eye','eye-slash','flask','folder-simple','gear-six','git-branch',
  'git-commit','hard-drives','heartbeat','key','lightning','list','list-magnifying-glass',
  'lock-simple','magnifying-glass','minus','moon','moon-stars','paper-plane-tilt',
  'pencil-simple','plugs','plugs-connected','plus','prohibit','push-pin','puzzle-piece',
  'rocket-launch','seal-check','shield-check','sign-in','sign-out','slack-logo',
  'sliders-horizontal','squares-four','sun','telegram-logo','trash','tree-structure',
  'warning','warning-octagon','webhooks-logo','x','x-circle',
];

const BASE = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets/regular';

// Extract the inner drawing elements (everything inside <svg>…</svg>), dropping
// the <svg> wrapper so our component controls size/viewBox/fill.
function innerSvg(svg) {
  const m = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (!m) throw new Error('no <svg> body');
  return m[1].replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}

const entries = [];
for (const name of NAMES) {
  const res = await fetch(`${BASE}/${name}.svg`);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  const body = innerSvg(await res.text());
  entries.push([name, body]);
  process.stderr.write(`ok ${name}\n`);
}

const union = entries.map(([n]) => `  | '${n}'`).join('\n');
const paths = entries
  .map(([n, b]) => `  '${n}': ${JSON.stringify(b)},`)
  .join('\n');

const out = `// GENERATED — do not edit by hand. Regenerate with scripts/gen-icons.mjs.
// Phosphor regular icons (@phosphor-icons/core@2.1.1), inlined so there is no
// runtime CDN dependency. The design is the source of truth for which glyphs
// exist; this set mirrors every icon Flightdeck.dc.html references.
import type { CSSProperties } from 'react';

export type IconName =
${union};

const PATHS: Record<IconName, string> = {
${paths}
};

export interface IconProps {
  name: IconName;
  /** Pixel size of the square glyph. Defaults to 18 to match body text. */
  size?: number;
  /**
   * Accessible label. When provided the glyph is exposed as an image with this
   * name; when omitted it is decorative and hidden from assistive tech.
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Inline SVG icon. Uses \`currentColor\` so it inherits text color and flips with
 * the theme. Decorative by default (aria-hidden); pass \`label\` to announce it.
 */
export function Icon({ name, size = 18, label, className, style }: IconProps) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      className={className}
      style={style}
      {...a11y}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
`;

const dest = process.argv[2];
writeFileSync(dest, out);
process.stderr.write(`\nwrote ${entries.length} icons to ${dest}\n`);
