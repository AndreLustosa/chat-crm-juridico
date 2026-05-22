'use client';

import { motion } from 'framer-motion';

export function ProgressRing({
  value,
  size = 72,
  stroke = 6,
  color = '#E6BE6A',
  track = 'rgba(255,255,255,0.08)',
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function Sparkline({
  data, color = '#43E0A0', width = 120, height = 36,
}: { data: number[]; color?: string; width?: number; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [i * step, height - ((d - min) / span) * (height - 6) - 3]);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <motion.path
        d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
    </svg>
  );
}

export function AreaChart({
  data, labels, color = '#E6BE6A', height = 200,
}: { data: number[]; labels?: string[]; color?: string; height?: number }) {
  if (!data.length) return null;
  const W = 720;
  const H = height;
  const pad = 16;
  const max = Math.max(...data) * 1.12;
  const min = Math.min(...data) * 0.7;
  const span = max - min || 1;
  const step = (W - pad * 2) / Math.max(1, data.length - 1);
  const x = (i: number) => pad + i * step;
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const last = data.length - 1;
  const gid = `aurumArea-${color.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} x2={W - pad} y1={pad + g * (H - pad * 2)} y2={pad + g * (H - pad * 2)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      ))}
      <motion.path d={area} fill={`url(#${gid})`} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.3 }} />
      <motion.path
        d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
        initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
        transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
        style={{ filter: `drop-shadow(0 6px 12px ${color}55)` }}
      />
      <motion.circle
        cx={x(last)} cy={y(data[last])} r={4.5} fill={color}
        initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }}
        transition={{ delay: 1.4, type: 'spring', stiffness: 300 }}
        style={{ filter: `drop-shadow(0 0 8px ${color})` }}
      />
    </svg>
  );
}

export function Donut({
  segments, size = 160, stroke = 22,
}: { segments: { label: string; value: number; color: string }[]; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
      {segments.map((seg, i) => {
        const frac = seg.value / total;
        const dash = frac * c;
        const gap = c - dash;
        const offset = -acc * c;
        acc += frac;
        return (
          <motion.circle
            key={seg.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${gap}`}
            initial={{ strokeDashoffset: c }} whileInView={{ strokeDashoffset: offset }} viewport={{ once: true }}
            transition={{ duration: 1.1, delay: 0.15 * i, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </svg>
  );
}

export function MiniBars({
  data, color = '#E6BE6A',
}: { data: { dia: string; valor: number }[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.valor)) || 1;
  return (
    <div className="flex h-full items-end gap-2">
      {data.map((d, i) => (
        <div key={d.dia + i} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex h-24 w-full items-end">
            <motion.div
              className="w-full rounded-md"
              style={{ background: `linear-gradient(to top, ${color}33, ${color})`, boxShadow: `0 0 12px -2px ${color}66` }}
              initial={{ height: 0 }} whileInView={{ height: `${(d.valor / max) * 100}%` }} viewport={{ once: true }}
              transition={{ duration: 0.8, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <span className="text-[10px] text-ink-3">{d.dia}</span>
        </div>
      ))}
    </div>
  );
}
