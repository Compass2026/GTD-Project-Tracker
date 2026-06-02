/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Department = 
  | 'Found It Marketing' 
  | 'Compass' 
  | 'Personal' 
  | 'Phone Calls'
  | 'Tech Allies'
  | 'BHG Safety'
  | 'House Plan Central'
  | 'Logic Solar'
  | 'Silverback Plumbing'
  | 'Show Me Design+Build'
  | 'Mad Hair Lab'
  | 'Lucas Construction'
  | 'Show Me Electrical'
  | 'Ginger Huff Interiors';

/** Static department list — always shown in sidebar regardless of DB data. */
export const STATIC_DEPARTMENTS: Department[] = [
  'Found It Marketing',
  'Compass',
  'Personal',
  'Phone Calls',
  'Tech Allies',
  'BHG Safety',
  'House Plan Central',
  'Logic Solar',
  'Silverback Plumbing',
  'Show Me Design+Build',
  'Mad Hair Lab',
  'Lucas Construction',
  'Show Me Electrical',
  'Ginger Huff Interiors',
];

/** Defines a parent department group and its optional child departments. */
export interface DepartmentGroup {
  name: string;
  children?: string[];
}

/** Sidebar hierarchy: top-level parents with optional nested children. */
export const DEPARTMENT_HIERARCHY: DepartmentGroup[] = [
  { name: 'Found It Marketing' },
  {
    name: 'Compass',
    children: [
      'Tech Allies',
      'BHG Safety',
      'House Plan Central',
      'Logic Solar',
      'Silverback Plumbing',
      'Show Me Design+Build',
      'Mad Hair Lab',
      'Lucas Construction',
      'Show Me Electrical',
      'Ginger Huff Interiors',
    ],
  },
  { name: 'Personal' },
  { name: 'Phone Calls' },
];

export type DailyFocus = 
  | 'Today' 
  | 'Tomorrow' 
  | 'This Week' 
  | 'Next Week' 
  | 'This Quarter' 
  | 'Waiting';

export type ProjectStatus = 'Active' | 'Waiting' | 'Follow Up' | 'Completed';

export type TimeBlock = '5 min' | '15 min' | '30 min' | '1 hour' | '2 hours';

export interface Project {
  id: string;
  department: Department | string;
  daily_focus: DailyFocus;
  project_name: string;
  status: ProjectStatus;
  time_block: TimeBlock;
  due_date?: string;
  current_next_action?: string;
  notes?: string;
  support_link?: string;
  drive_link?: string;
  last_reviewed?: string;
}

export const FOCUS_ORDER: DailyFocus[] = [
  'Today',
  'Tomorrow',
  'This Week',
  'Next Week',
  'This Quarter',
  'Waiting'
];

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  'Active': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  'Waiting': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  'Follow Up': 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  'Completed': 'bg-purple-500/10 text-purple-500 border-purple-500/20'
};
