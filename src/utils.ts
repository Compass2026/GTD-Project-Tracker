/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { type CSSProperties } from 'react';

/**
 * Deterministic djb2-style hash → integer for a string.
 * Produces consistent results for the same string every time.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Pinned overrides — specific department names always get these exact colors.
 * Each entry: [background, text, dot-color].
 * Add new entries here to lock a department to a specific color.
 */
const PINNED_DEPARTMENTS: Record<string, [string, string, string]> = {
  'Found It Marketing': ['#ea580c', '#ffffff', '#fb923c'], // orange-600
  'Found It':           ['#ea580c', '#ffffff', '#fb923c'], // orange-600 (alias)
  'Compass':            ['#2554e3', '#ffffff', '#93c5fd'], // royal blue
  'Personal':           ['#22c55e', '#000000', '#86efac'], // green-500 (light green)
  'BHG Safety':         ['#475569', '#ffffff', '#94a3b8'], // slate-600 (grey)
};

/**
 * Bold, high-saturation department badge palette.
 * Each entry: [background, text, dot-color].
 * Used as fallback for departments not in PINNED_DEPARTMENTS.
 */
const BOLD_PALETTE: [string, string, string][] = [
  ['#2563eb', '#ffffff', '#60a5fa'], // blue-600
  ['#dc2626', '#ffffff', '#f87171'], // red-600
  ['#059669', '#ffffff', '#34d399'], // emerald-600
  ['#d97706', '#000000', '#fbbf24'], // amber-600
  ['#7c3aed', '#ffffff', '#a78bfa'], // violet-600
  ['#db2777', '#ffffff', '#f472b6'], // pink-600
  ['#0891b2', '#ffffff', '#22d3ee'], // cyan-600
  ['#65a30d', '#000000', '#a3e635'], // lime-600
  ['#4f46e5', '#ffffff', '#818cf8'], // indigo-600
  ['#0284c7', '#ffffff', '#38bdf8'], // sky-600
  ['#9333ea', '#ffffff', '#c084fc'], // purple-600
  ['#0d9488', '#ffffff', '#2dd4bf'], // teal-600
  ['#e11d48', '#ffffff', '#fb7185'], // rose-600
  ['#c026d3', '#ffffff', '#e879f9'], // fuchsia-600
  ['#b45309', '#ffffff', '#fcd34d'], // amber-700 (warm gold)
  ['#166534', '#ffffff', '#4ade80'], // green-800 (deep forest)
  ['#9f1239', '#ffffff', '#fda4af'], // rose-800 (burgundy)
  ['#713f12', '#ffffff', '#fde68a'], // yellow-900 (caramel)
];

/** Resolve the palette entry for a department — pinned first, hash-based fallback. */
function resolvePalette(department: string): [string, string, string] {
  if (PINNED_DEPARTMENTS[department]) return PINNED_DEPARTMENTS[department];
  return BOLD_PALETTE[hashString(department) % BOLD_PALETTE.length];
}

export function getDepartmentStyle(department: string): CSSProperties {
  if (!department) {
    return { backgroundColor: 'rgba(113,113,122,0.15)', color: '#a1a1aa', border: '1px solid rgba(113,113,122,0.25)' };
  }
  const [bg, text] = resolvePalette(department);
  return {
    backgroundColor: bg,
    color: text,
    border: 'none',
    fontWeight: 700,
  };
}

/**
 * Returns just the dot color for the sidebar department indicator.
 * Matched to the BOLD_PALETTE entry so dots align with badge hues.
 */
export function getDepartmentDotColor(department: string): string {
  if (!department) return '#a1a1aa';
  return resolvePalette(department)[2];
}

/**
 * Formats a due date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm) into a human-readable display string.
 * Example output: "Apr 28, 2:00 PM" or "Apr 28"
 */
export function formatDueDate(dueDate?: string): string {
  if (!dueDate) return '';
  const isIsoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(dueDate);
  const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate);

  if (!isIsoDateTime && !isIsoDate) return dueDate;

  const dateStr = dueDate.substring(0, 10);
  const [year, month, day] = dateStr.split('-');
  const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  
  const monthName = dateObj.toLocaleString('en-US', { month: 'short' });
  const dayName = dateObj.getDate();
  
  if (isIsoDateTime) {
    const timeStr = dueDate.substring(11, 16);
    let [hours, minutes] = timeStr.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return `${monthName} ${dayName}, ${hours}:${minutesStr} ${ampm}`;
  }
  
  return `${monthName} ${dayName}`;
}

// Keep legacy export for any callers not yet migrated
export const getDepartmentColor = (_department: string) => 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';

export function parseTimeBlockToMinutes(timeBlock?: string): number {
  if (!timeBlock) return 0;
  const lower = timeBlock.toLowerCase();
  if (lower.includes('min')) {
    return parseInt(lower, 10) || 0;
  }
  if (lower.includes('hour')) {
    const hours = parseInt(lower, 10) || 0;
    return hours * 60;
  }
  return 0;
}

export function formatMinutes(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return '0m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${minutes}m`;
  }
}

