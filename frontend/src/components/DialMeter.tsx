import { useEffect, useRef, useState } from 'react';

interface DialMeterProps {
  value: number;          // 0..100
  label?: string;
  size?: number;          // px, default 220
  color?: string;         // needle/accent, default amber
}

/**
 * Steampunk dial meter widget.
 * Pure SVG, crisp at any resolution, no external assets.
 */
export function DialMeter({ value, label = 'PRESSURE', size = 220, color = '#ffb347' }: DialMeterProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;

  // Sweep from -210deg (value 0) to +30deg (value 100) => 240deg total
  const startAngle = -210;
  const endAngle = 30;
  const sweep = endAngle - startAngle;
  const angle = startAngle + (clamped / 100) * sweep;

  const polar = (deg: number, radius: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  // Build tick marks
  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const a = startAngle + (i / 10) * sweep;
    const major = i % 5 === 0;
    const outer = polar(a, r);
    const inner = polar(a, r - (major ? 16 : 9));
    ticks.push(
      <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
        stroke={major ? '#e8d9b0' : '#9a8f6f'} strokeWidth={major ? 2.5 : 1.2} />
    );
    if (major) {
      const t = polar(a, r - 26);
      ticks.push(
        <text key={'t' + i} x={t.x} y={t.y} fill="#e8d9b0" fontSize={size * 0.055}
          textAnchor="middle" dominantBaseline="middle" fontFamily="monospace">
          {i * 10}
        </text>
      );
    }
  }

  const needleTip = polar(angle, r - 22);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id="face" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="#f4ecd6" />
          <stop offset="70%" stopColor="#e6d9b8" />
          <stop offset="100%" stopColor="#cbb98f" />
        </radialGradient>
        <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e9c46a" />
          <stop offset="45%" stopColor="#b08d3e" />
          <stop offset="100%" stopColor="#6e5420" />
        </linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Bezel */}
      <circle cx={cx} cy={cy} r={size / 2 - 2} fill="url(#brass)" />
      <circle cx={cx} cy={cy} r={r + 6} fill="#2a2620" />
      {/* Face */}
      <circle cx={cx} cy={cy} r={r} fill="url(#face)" />

      {/* Rivets */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * 360;
        const p = polar(a, size / 2 - 8);
        return <circle key={i} cx={p.x} cy={p.y} r={2.4} fill="#5a4620" stroke="#f0d98a" strokeWidth={0.6} />;
      })}

      {ticks}

      {/* Value arc */}
      <path
        d={`M ${polar(startAngle, r - 4).x} ${polar(startAngle, r - 4).y} A ${r - 4} ${r - 4} 0 ${clamped > 50 ? 1 : 0} 1 ${polar(angle, r - 4).x} ${polar(angle, r - 4).y}`}
        fill="none" stroke={color} strokeWidth={3} opacity={0.55} filter="url(#glow)" />

      {/* Needle */}
      <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} stroke={color} strokeWidth={3} strokeLinecap="round" filter="url(#glow)" />
      <circle cx={cx} cy={cy} r={7} fill="#3a2f1a" stroke={color} strokeWidth={2} />

      {/* Nixie readout */}
      <rect x={cx - size * 0.16} y={cy + r * 0.32} width={size * 0.32} height={size * 0.14} rx={4} fill="#1a1408" stroke="#6e5420" strokeWidth={1.5} />
      <text x={cx} y={cy + r * 0.32 + size * 0.09} fill={color} fontSize={size * 0.085}
        textAnchor="middle" fontFamily="monospace" filter="url(#glow)" fontWeight="bold">
        {Math.round(clamped)}
      </text>

      {/* Label */}
      <text x={cx} y={cy - r * 0.45} fill="#6e5420" fontSize={size * 0.05}
        textAnchor="middle" fontFamily="monospace" letterSpacing="2">
        {label}
      </text>
    </svg>
  );
}
