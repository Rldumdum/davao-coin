// Hand-drawn SVG icons for every item and currency. 48x48 viewBox, no external assets.
import type { ReactNode } from 'react';
import { ITEM } from '../world-data';

type IconProps = { size?: number };

function Svg({ size = 40, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {children}
    </svg>
  );
}

function Ore({ fill, light, dark, size }: { fill: string; light: string; dark: string; size?: number }) {
  return (
    <Svg size={size}>
      <path d="M8 30 L14 16 L26 10 L38 15 L42 28 L34 39 L18 40 Z" fill="#7a7468" />
      <path d="M8 30 L14 16 L26 10 L22 24 Z" fill="#8e887b" />
      <path d="M18 22 L24 17 L30 21 L27 28 L20 28 Z" fill={fill} />
      <path d="M18 22 L24 17 L24 24 Z" fill={light} />
      <path d="M30 29 L35 26 L37 31 L32 34 Z" fill={fill} />
      <path d="M14 31 L18 29 L19 34 L15 35 Z" fill={dark} />
      <path d="M27 28 L20 28 L24 24 Z" fill={dark} opacity="0.5" />
    </Svg>
  );
}

function Crystal({ size }: IconProps) {
  return (
    <Svg size={size}>
      <ellipse cx="24" cy="40" rx="15" ry="4" fill="#3b2a55" opacity="0.5" />
      <path d="M24 4 L31 18 L27 40 L21 40 L17 18 Z" fill="#b77bff" />
      <path d="M24 4 L24 40 L21 40 L17 18 Z" fill="#d7b5ff" />
      <path d="M12 16 L17 26 L15 40 L10 40 L8 26 Z" fill="#9a5cf0" />
      <path d="M37 18 L41 27 L38 40 L33 40 L32 28 Z" fill="#9a5cf0" />
      <path d="M37 18 L36 40 L33 40 L32 28 Z" fill="#c69bff" />
    </Svg>
  );
}

function Durian({ size }: IconProps) {
  const spikes = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const x2 = 24 + Math.cos(a) * 19;
    const y2 = 26 + Math.sin(a) * 20;
    const xa = 24 + Math.cos(a - 0.14) * 14;
    const ya = 26 + Math.sin(a - 0.14) * 15;
    const xb = 24 + Math.cos(a + 0.14) * 14;
    const yb = 26 + Math.sin(a + 0.14) * 15;
    return <path key={i} d={`M${xa} ${ya} L${x2} ${y2} L${xb} ${yb} Z`} fill="#7d8f25" />;
  });
  return (
    <Svg size={size}>
      {spikes}
      <ellipse cx="24" cy="26" rx="14.5" ry="15.5" fill="#a3b23a" />
      <ellipse cx="20" cy="21" rx="5" ry="6" fill="#c3d160" opacity="0.6" />
      {[
        [18, 30],
        [28, 22],
        [29, 33],
        [22, 37],
        [16, 23],
      ].map(([x, y], i) => (
        <path key={i} d={`M${x! - 2} ${y! + 2} L${x} ${y! - 3} L${x! + 2} ${y! + 2} Z`} fill="#7d8f25" />
      ))}
      <rect x="22.5" y="5" width="3" height="7" rx="1.5" fill="#6b4a2a" />
    </Svg>
  );
}

function Pomelo({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M24 6 C35 6 42 18 42 28 C42 38 34 43 24 43 C14 43 6 38 6 28 C6 18 13 6 24 6 Z" fill="#b9d36a" />
      <path d="M24 6 C16 8 11 18 11 27 C11 34 15 39 20 41 C12 40 6 35 6 28 C6 18 13 6 24 6 Z" fill="#9fbd50" />
      <ellipse cx="30" cy="18" rx="5" ry="7" fill="#dbeb9a" opacity="0.7" />
      <path d="M24 6 L24 2" stroke="#6b4a2a" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M24 4 C28 0 34 1 35 4 C31 6 27 6 24 4 Z" fill="#4f8a3c" />
    </Svg>
  );
}

function Mangosteen({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="24" cy="28" r="15" fill="#5b2a4e" />
      <circle cx="19" cy="23" r="5" fill="#7d4570" opacity="0.7" />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = -Math.PI / 2 + (i - 2) * 0.55;
        return <ellipse key={i} cx={24 + Math.cos(a) * 6} cy={15 + Math.sin(a) * 3 + 2} rx="4.5" ry="2.6" fill="#4f8a3c" transform={`rotate(${(i - 2) * 30} ${24 + Math.cos(a) * 6} ${17 + Math.sin(a) * 3})`} />;
      })}
      <rect x="22.8" y="6" width="2.4" height="7" rx="1.2" fill="#6b4a2a" />
    </Svg>
  );
}

function Pickaxe({ metal, light, size }: { metal: string; light: string; size?: number }) {
  return (
    <Svg size={size}>
      <path d="M13 41 L33 15" stroke="#7a5230" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M13 41 L33 15" stroke="#9a6c42" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 16 C16 6 30 4 42 10 C34 9 26 11 20 16 L33 15 L28 20 C22 15 14 15 8 16 Z" fill={metal} />
      <path d="M8 16 C16 6 30 4 42 10 C30 7 18 9 8 16 Z" fill={light} />
    </Svg>
  );
}

export function DurianCoinIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#e2b43a" />
      <circle cx="12" cy="12" r="8.5" fill="#f2cc58" stroke="#b8891c" strokeWidth="1" />
      <path d="M12 6.5 L13.6 10 L17.5 10.3 L14.5 12.8 L15.5 16.6 L12 14.5 L8.5 16.6 L9.5 12.8 L6.5 10.3 L10.4 10 Z" fill="#8a9a2c" />
    </svg>
  );
}

export function EthIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#3c3f6e" />
      <path d="M12 3.5 L17 12.2 L12 15.2 L7 12.2 Z" fill="#c8ccff" />
      <path d="M12 3.5 L12 15.2 L7 12.2 Z" fill="#ffffff" />
      <path d="M12 16.3 L17 13.3 L12 20.5 L7 13.3 Z" fill="#c8ccff" />
      <path d="M12 16.3 L12 20.5 L7 13.3 Z" fill="#ffffff" />
    </svg>
  );
}

export function ItemIcon({ id, size = 40 }: { id: number; size?: number }) {
  switch (id) {
    case ITEM.COPPER_ORE:
      return <Ore size={size} fill="#c8743a" light="#e9a26a" dark="#7a3f17" />;
    case ITEM.SILVER_ORE:
      return <Ore size={size} fill="#d6dde3" light="#ffffff" dark="#8b98a5" />;
    case ITEM.GOLD_NUGGET:
      return <Ore size={size} fill="#f5c62a" light="#fff09a" dark="#a7780a" />;
    case ITEM.APO_CRYSTAL:
      return <Crystal size={size} />;
    case ITEM.DURIAN_FRUIT:
      return <Durian size={size} />;
    case ITEM.POMELO:
      return <Pomelo size={size} />;
    case ITEM.MANGOSTEEN:
      return <Mangosteen size={size} />;
    case ITEM.IRON_PICKAXE:
      return <Pickaxe size={size} metal="#9aa3ad" light="#d6dde3" />;
    case ITEM.GOLD_PICKAXE:
      return <Pickaxe size={size} metal="#e0ad1f" light="#ffe27a" />;
    default:
      return <Svg size={size}>{null}</Svg>;
  }
}
