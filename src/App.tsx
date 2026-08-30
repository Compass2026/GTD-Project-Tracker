/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from 'react';
import {
  Plus,
  Search,
  ExternalLink,
  X,
  Menu,
  Zap,
  Layout,
  List,
  CheckCircle2,
  Archive,
  Sun,
  Moon,
  Clock,
  ChevronDown,
  ChevronRight,
  Bell,
  Calendar,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Project,
  DailyFocus,
  ProjectStatus,
  TimeBlock,
  FOCUS_ORDER,
  STATUS_COLORS,
  Department,
  STATIC_DEPARTMENTS,
  DEPARTMENT_HIERARCHY,
  type Owner,
  OWNER_OPTIONS,
  OWNER_COLORS,
} from './types';
import { supabase } from './supabaseClient';
import { getDepartmentStyle, getDepartmentDotColor, formatDueDate, parseTimeBlockToMinutes, formatMinutes, generateICS } from './utils';
import { useNotifications } from './hooks/useNotifications';
import { useCalendarSync } from './hooks/useCalendarSync';
import { marked } from 'marked';

// ── helpers: map between DB (CSV column keys) and internal Project shape ──────
// Stable client-side id derived from Project Name (table has no id column)
function stableId(projectName: string): string {
  return btoa(encodeURIComponent(projectName)).replace(/=/g, '');
}

function dbRowToProject(row: Record<string, unknown>): Project {
  const name = (row['Project Name'] as string) ?? '';
  return {
    id: stableId(name),
    department: (row['Department'] as string) ?? '',
    daily_focus: (row['Daily Focus'] as DailyFocus) ?? 'Today',
    project_name: name,
    status: (row['Status'] as ProjectStatus) ?? 'Active',
    time_block: (row['Time Block'] as TimeBlock) ?? '15 min',
    owner: (row['Owner'] as string) ?? 'TOM',
    due_date: (row['Due Date'] as string) ?? undefined,
    current_next_action: (row['Current Next Action'] as string) ?? undefined,
    notes: (row['Notes'] as string) ?? undefined,
    support_link: (row['Support Link'] as string) ?? undefined,
    completed_at: (row['Completed At'] as string) ?? undefined,
  };
}

function projectToDbRow(p: Omit<Project, 'id'>): Record<string, unknown> {
  return {
    'Department': p.department,
    'Daily Focus': p.daily_focus,
    'Project Name': p.project_name,
    'Status': p.status,
    'Time Block': p.time_block,
    'Owner': p.owner ?? 'TOM',
    'Due Date': p.due_date ?? null,
    'Current Next Action': p.current_next_action ?? null,
    'Notes': p.notes ?? null,
    'Support Link': p.support_link ?? null,
  };
}

// ── Card order persistence key ───────────────────────────────────────────────
const CARD_ORDER_KEY = 'compass-card-order';

/** Load saved order map: { [projectId]: sortIndex } */
function loadCardOrder(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CARD_ORDER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Save order map to localStorage */
function saveCardOrder(order: Record<string, number>) {
  try {
    localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(order));
  } catch {
    // storage full — silently ignore
  }
}

/** Apply a saved order map to a project array, preserving relative DB order for unknowns. */
function applyCardOrder(projects: Project[], order: Record<string, number>): Project[] {
  return [...projects].sort((a, b) => {
    // 1. Sort by due date (ascending, projects with dates first)
    const dateA = a.due_date?.trim();
    const dateB = b.due_date?.trim();

    if (dateA && dateB) {
      if (dateA < dateB) return -1;
      if (dateA > dateB) return 1;
    } else if (dateA) {
      return -1;
    } else if (dateB) {
      return 1;
    }

    // 2. Secondary sort: saved manual order
    const oa = order[a.id] ?? Infinity;
    const ob = order[b.id] ?? Infinity;
    if (oa !== ob) return oa - ob;

    return 0; // preserve relative order for remaining
  });
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [cardOrder, setCardOrder] = useState<Record<string, number>>(loadCardOrder);
  const [isLoading, setIsLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    // Sync-apply dark class immediately so first paint is correct
    const stored = localStorage.getItem('compass-dark-mode');
    // Default to dark if no preference is stored
    const dark = stored !== null ? stored === 'true' : true;
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return dark;
  });
  const [selectedDept, setSelectedDept] = useState<string>('All');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [viewMode, setViewMode] = useState<'board' | 'list' | 'archive'>('board');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  // Track which parent groups are expanded in the sidebar (Compass open by default)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(['Compass']));

  const { requestPermission, permissionStatus } = useNotifications(projects);
  const { syncCalendar, getCalendarUrl, isSyncing } = useCalendarSync();

  // ── Automatic Calendar Sync ───────────────────────────────────────────────
  // Sync to storage whenever projects change (debounced to avoid spamming)
  useEffect(() => {
    if (projects.length === 0) return;
    
    const timer = setTimeout(() => {
      syncCalendar(projects);
    }, 2000); // 2 second debounce

    return () => clearTimeout(timer);
  }, [projects, syncCalendar]);

  const handleExportICS = () => {
    const icsContent = generateICS(projects.filter(p => p.status !== 'Completed'));
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'compass-deadlines.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ── Fetch all projects on mount ───────────────────────────────────────────
  useEffect(() => {
    async function fetchProjects() {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('gtd_projects')
        .select('*');
      if (error) {
        console.error('Error fetching projects:', error);
      } else {
        const fetched = (data ?? []).map(dbRowToProject);
        // Apply saved card order so positions survive page reloads
        const savedOrder = loadCardOrder();
        setProjects(applyCardOrder(fetched, savedOrder));
        setCardOrder(savedOrder);
      }
      setIsLoading(false);
    }
    fetchProjects();
  }, []);

  // ── Supabase Realtime: live-sync gtd_projects across tabs/sessions ────────
  useEffect(() => {
    console.log('[Realtime] Subscribing to gtd_projects channel...');

    const channel = supabase
      .channel('gtd_projects_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gtd_projects' },
        (payload) => {
          console.log('[Realtime] INSERT event:', payload.new);
          const incoming = dbRowToProject(payload.new as Record<string, unknown>);
          setProjects((prev) => {
            // Deduplication: if this tab already added the project optimistically,
            // the same stableId will already exist — skip the insert.
            const alreadyExists = prev.some((p) => p.id === incoming.id);
            if (alreadyExists) {
              console.log('[Realtime] INSERT skipped (already in state):', incoming.project_name);
              return prev;
            }
            console.log('[Realtime] INSERT applied:', incoming.project_name);
            return [incoming, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'gtd_projects' },
        (payload) => {
          console.log('[Realtime] UPDATE event:', payload.new);
          const updated = dbRowToProject(payload.new as Record<string, unknown>);
          setProjects((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p))
          );
          // If the updated project is open in the modal, refresh it too
          setSelectedProject((current) => {
            if (current && current.id === updated.id) {
              console.log('[Realtime] UPDATE applied to open modal:', updated.project_name);
              return updated;
            }
            return current;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'gtd_projects' },
        (payload) => {
          console.log('[Realtime] DELETE event:', payload.old);
          const deletedName = (payload.old as Record<string, unknown>)['Project Name'] as string;
          const deletedId = stableId(deletedName);
          setProjects((prev) => {
            const next = prev.filter((p) => p.id !== deletedId);
            console.log('[Realtime] DELETE applied:', deletedName);
            return next;
          });
          // Close the edit modal if the open project was deleted remotely
          setSelectedProject((current) => {
            if (current && current.id === deletedId) {
              console.log('[Realtime] DELETE closed modal for:', deletedName);
              return null;
            }
            return current;
          });
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Channel status:', status);
      });

    return () => {
      console.log('[Realtime] Cleaning up gtd_projects channel');
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Complete project ─────────────────────────────────────────────────────
  const completeProject = useCallback(async (id: string) => {
    const target = projects.find(p => p.id === id);
    if (!target) return;
    const completedAt = new Date().toISOString();
    // Optimistic update
    setProjects(prev => prev.map(p => p.id === id ? { ...p, status: 'Completed', completed_at: completedAt } : p));
    const { error } = await supabase
      .from('gtd_projects')
      .update({ 'Status': 'Completed', 'Completed At': completedAt })
      .eq('Project Name', target.project_name);
    if (error) {
      console.error('Failed to complete project:', error);
      // Rollback
      setProjects(prev => prev.map(p => p.id === id ? { ...p, status: target.status } : p));
    }
  }, [projects]);

  // Resolve which departments are active for the current filter selection.
  // Selecting a parent (e.g. "Compass") includes itself + all its children.
  const filterDepts = useMemo(() => {
    if (selectedDept === 'All') return null;
    const group = DEPARTMENT_HIERARCHY.find(g => g.name === selectedDept);
    if (group?.children) return [group.name, ...group.children];
    return [selectedDept];
  }, [selectedDept]);

  // Filter projects by department AND search query (active = non-Completed)
  // cardOrder is applied here so filtered views also respect the saved sort.
  const filteredProjects = useMemo(() => {
    let result = projects.filter(p => p.status !== 'Completed');
    if (filterDepts) result = result.filter(p => filterDepts.includes(p.department));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.project_name.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q)
      );
    }
    // Re-apply card order after filtering so within-column order is always correct
    return applyCardOrder(result, cardOrder);
  }, [projects, filterDepts, searchQuery, cardOrder]);

  // Completed projects (archive)
  const archivedProjects = useMemo(() => {
    let result = projects.filter(p => p.status === 'Completed');
    if (filterDepts) result = result.filter(p => filterDepts.includes(p.department));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.project_name.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q)
      );
    }
    // Newest completions first; legacy rows without a timestamp sink to the bottom.
    return [...result].sort((a, b) => {
      if (!a.completed_at && !b.completed_at) return 0;
      if (!a.completed_at) return 1;
      if (!b.completed_at) return -1;
      return b.completed_at.localeCompare(a.completed_at);
    });
  }, [projects, filterDepts, searchQuery]);

  // Unique departments: always show the static list, plus any extra depts from DB not already in it
  const departments = useMemo(() => {
    const dynamicDepts = projects.map(p => p.department);
    const merged = [...STATIC_DEPARTMENTS, ...dynamicDepts.filter(d => !STATIC_DEPARTMENTS.includes(d as Department))];
    return ['All', ...merged];
  }, [projects]);

  // ── Drag-and-drop: optimistic update + Supabase persist ──────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const dragged = projects.find(p => p.id === event.active.id);
    setActiveProject(dragged ?? null);
  }, [projects]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveProject(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedProject = projects.find(p => p.id === active.id);
    if (!draggedProject) return;

    // Determine whether we dropped on a column zone or another card
    const isDroppedOnColumn = FOCUS_ORDER.includes(over.id as DailyFocus);
    const overProject = isDroppedOnColumn ? null : projects.find(p => p.id === over.id);
    const newFocus: DailyFocus = isDroppedOnColumn
      ? (over.id as DailyFocus)
      : (overProject?.daily_focus ?? draggedProject.daily_focus);

    const isSameColumn = draggedProject.daily_focus === newFocus;

    if (isSameColumn) {
      // ── Within-column reorder ─────────────────────────────────────────────
      // Get the ordered list of projects in this column (same order the UI rendered)
      const columnProjects = applyCardOrder(
        projects.filter(p => p.daily_focus === newFocus && p.status !== 'Completed'),
        cardOrder
      );
      const oldIndex = columnProjects.findIndex(p => p.id === active.id);
      const newIndex = columnProjects.findIndex(p => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      // Reorder within the column
      const reordered = arrayMove(columnProjects, oldIndex, newIndex);

      // Rebuild the full projects array with the new column order spliced in
      setProjects(prev => {
        const others = prev.filter(p => p.daily_focus !== newFocus || p.status === 'Completed');
        // Preserve completed projects at their position; splice reordered active ones in
        return [...others, ...reordered];
      });

      // Assign new sort indices to all projects (global, monotonic)
      const newOrder = { ...cardOrder };
      // Give each reordered project a stable integer position
      reordered.forEach((p, i) => {
        newOrder[p.id] = i * 10; // multiples of 10 leave room for future inserts
      });
      setCardOrder(newOrder);
      saveCardOrder(newOrder);
    } else {
      // ── Cross-column move ─────────────────────────────────────────────────
      // Update daily_focus optimistically
      setProjects(prev =>
        prev.map(p => p.id === draggedProject.id ? { ...p, daily_focus: newFocus } : p)
      );

      // Place the card at the position of the card it was dropped on (if any)
      const newOrder = { ...cardOrder };
      if (overProject) {
        // Slot the dragged card just before the card it landed on
        const targetIdx = newOrder[overProject.id] ?? 0;
        newOrder[draggedProject.id] = targetIdx - 1;
      } else {
        // Dropped on column zone — put it at the end
        const colProjects = projects.filter(p => p.daily_focus === newFocus);
        const maxIdx = colProjects.reduce((m, p) => Math.max(m, newOrder[p.id] ?? 0), 0);
        newOrder[draggedProject.id] = maxIdx + 10;
      }
      setCardOrder(newOrder);
      saveCardOrder(newOrder);

      // Persist focus change to Supabase
      const { error } = await supabase
        .from('gtd_projects')
        .update({ 'Daily Focus': newFocus })
        .eq('Project Name', draggedProject.project_name);
      if (error) {
        console.error('Failed to update Daily Focus:', error);
        // Rollback
        setProjects(prev =>
          prev.map(p => p.id === draggedProject.id ? { ...p, daily_focus: draggedProject.daily_focus } : p)
        );
      }
    }
  }, [projects, cardOrder]);

  // Handle theme — apply .dark on <html> so Tailwind dark: utilities match
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('compass-dark-mode', String(isDarkMode));
  }, [isDarkMode]);

  // ── INSERT ────────────────────────────────────────────────────────────────
  // Returns true on success, false on failure (error is surfaced via alert).
  const addProject = async (newProject: Omit<Project, 'id'>): Promise<boolean> => {
    const payload = projectToDbRow(newProject);

    const { error } = await supabase
      .from('gtd_projects')
      .insert([payload]);

    if (error) {
      console.error('Error creating project:', error);
      window.alert(`Failed to create project:\n\n${error.message}`);
      return false;
    }

    // Build the Project locally — no id column in DB, derive it client-side
    const created: Project = {
      ...newProject,
      id: stableId(newProject.project_name),
    };
    setProjects(prev => [created, ...prev]);
    setIsCreateModalOpen(false);
    return true;
  };

  // ── UPDATE (match on 'Project Name' — no id column in DB) ───────────────
  const updateProject = useCallback(async (updatedProject: Project) => {
    // Find the original project name to use as the DB match key.
    // Must use the functional form of setProjects so we always work from the
    // latest snapshot — avoids stale-closure misses when a dropdown interaction
    // triggers a re-render between the modal opening and the user clicking Save.
    const original = projects.find(p => p.id === updatedProject.id);
    if (!original) {
      console.warn('updateProject: could not find original project for id', updatedProject.id);
      return;
    }
    const row = projectToDbRow(updatedProject);
    // Stamp/clear the completion timestamp only on an actual status transition,
    // so ordinary edits never clobber an existing "Completed At".
    if (updatedProject.status === 'Completed' && original.status !== 'Completed') {
      updatedProject = { ...updatedProject, completed_at: new Date().toISOString() };
      row['Completed At'] = updatedProject.completed_at;
    } else if (updatedProject.status !== 'Completed' && original.status === 'Completed') {
      updatedProject = { ...updatedProject, completed_at: undefined };
      row['Completed At'] = null;
    }
    const { error } = await supabase
      .from('gtd_projects')
      .update(row)
      .eq('Project Name', original.project_name);
    if (error) {
      console.error('Error updating project:', error);
      window.alert(`Failed to save changes:\n\n${error.message}`);
      return;
    }
    // Re-derive id in case the project name changed
    const newId = stableId(updatedProject.project_name);
    const saved: Project = { ...updatedProject, id: newId };
    // Use the OLD id (updatedProject.id) to locate the entry in the list,
    // then replace it with the saved version (which may have a new id).
    setProjects(prev => prev.map(p => p.id === updatedProject.id ? saved : p));
    setSelectedProject(null);
  }, [projects]);

  // ── DELETE (match on 'Project Name' — no id column in DB) ──────────────
  const deleteProject = async (id: string) => {
    const target = projects.find(p => p.id === id);
    if (!target) return;
    const { error } = await supabase
      .from('gtd_projects')
      .delete()
      .eq('Project Name', target.project_name);
    if (error) {
      console.error('Error deleting project:', error);
      return;
    }
    setProjects(prev => prev.filter(p => p.id !== id));
    setSelectedProject(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-200 flex h-screen text-zinc-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Sidebar — on mobile it overlays; on md+ it pushes content */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <>
            {/* Backdrop — only visible on mobile */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/50 z-30 md:hidden"
            />
            <motion.aside
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              className="fixed md:relative w-72 md:w-64 h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex-shrink-0 flex flex-col z-40 md:z-20"
            >
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
                <div className="w-7 h-7 bg-purple-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-purple-600/30">
                  <Zap size={14} fill="currentColor" />
                </div>
                Compass GTD
              </h1>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 px-3">
                Departments
              </p>

              <div className="space-y-0.5">
                {/* All */}
                <button
                  onClick={() => setSelectedDept('All')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    selectedDept === 'All'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selectedDept === 'All' ? 'rgba(255,255,255,0.7)' : '#94a3b8' }} />
                  <span className="flex-1 text-left">All</span>
                </button>

                {/* Parent groups */}
                {DEPARTMENT_HIERARCHY.map((group) => {
                  const isParentActive = selectedDept === group.name;
                  const isExpanded = expandedGroups.has(group.name);
                  const hasChildren = !!(group.children && group.children.length > 0);

                  return (
                    <div key={group.name}>
                      <button
                        onClick={() => {
                          setSelectedDept(group.name);
                          if (hasChildren) {
                            setExpandedGroups(prev => {
                              const next = new Set(prev);
                              if (next.has(group.name)) next.delete(group.name);
                              else next.add(group.name);
                              return next;
                            });
                          }
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                          isParentActive
                            ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: isParentActive ? 'rgba(255,255,255,0.7)' : getDepartmentDotColor(group.name) }}
                        />
                        <span className="flex-1 text-left truncate">{group.name}</span>
                        {hasChildren && (
                          isExpanded
                            ? <ChevronDown size={13} className="shrink-0 opacity-60" />
                            : <ChevronRight size={13} className="shrink-0 opacity-60" />
                        )}
                      </button>

                      {/* Children */}
                      {hasChildren && isExpanded && (
                        <div className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                          {group.children!.map((child) => {
                            const isChildActive = selectedDept === child;
                            return (
                              <button
                                key={child}
                                onClick={() => setSelectedDept(child)}
                                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                                  isChildActive
                                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                                }`}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: isChildActive ? 'rgba(255,255,255,0.7)' : getDepartmentDotColor(child) }}
                                />
                                <span className="truncate">{child}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Archive link */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 mt-3">
                <button
                  onClick={() => setViewMode('archive')}
                  className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    viewMode === 'archive'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Archive size={14} className="shrink-0" />
                  <span>Completed Archive</span>
                  {archivedProjects.length > 0 && (
                    <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      viewMode === 'archive' ? 'bg-white/20 text-white' : 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400'
                    }`}>
                      {archivedProjects.length}
                    </span>
                  )}
                </button>
              </div>
            </nav>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">
                  Sync & Notifications
                </p>
                <div className="space-y-1">
                  <button
                    onClick={requestPermission}
                    disabled={permissionStatus === 'granted'}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      permissionStatus === 'granted'
                        ? 'text-emerald-500 bg-emerald-500/10'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Bell size={14} className={permissionStatus === 'granted' ? 'fill-current' : ''} />
                    <span>{permissionStatus === 'granted' ? 'Notifications Active' : 'Enable Notifications'}</span>
                  </button>
                  <button
                    onClick={() => {
                      const url = getCalendarUrl();
                      navigator.clipboard.writeText(url);
                      window.alert('Calendar Feed Link copied to clipboard!\n\nTo subscribe on Mac/iPhone:\n1. Open Calendar App\n2. File > New Calendar Subscription\n3. Paste this link');
                      // Also try to open it directly
                      window.open(url, '_blank');
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all"
                  >
                    <Calendar size={14} className={isSyncing ? 'animate-pulse' : ''} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync to Apple/Mac Calendar'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Appearance</span>
                <button
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                  className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              </div>
            </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950">
        {/* Header */}
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 bg-white dark:bg-slate-900 z-30 sticky top-0 shadow-sm">
          <div className="flex items-center gap-3 md:gap-6">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 -ml-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Toggle sidebar"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center text-sm font-medium tracking-tight">
              <span className="hidden sm:inline text-zinc-400">Projects</span>
              <span className="hidden sm:inline mx-2 text-zinc-200 dark:text-zinc-700">/</span>
              <span className="text-zinc-900 dark:text-zinc-100 text-xs sm:text-sm">
                {viewMode === 'archive' ? 'Completed Archive' : selectedDept === 'All' ? 'Active View' : selectedDept}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {/* View Toggle */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              <button 
                onClick={() => setViewMode('board')}
                className={`p-2 rounded-md transition-all ${viewMode === 'board' ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                title="Board View"
              >
                <Layout size={16} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                title="List View"
              >
                <List size={16} />
              </button>
              <button 
                onClick={() => setViewMode('archive')}
                className={`p-2 rounded-md transition-all ${viewMode === 'archive' ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                title="Completed Archive"
              >
                <Archive size={16} />
              </button>
            </div>

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 transition-all focus-within:border-purple-500 dark:focus-within:border-purple-500">
              <Search size={14} className="text-zinc-400" />
              <input
                type="text"
                placeholder="Search projects or department..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs focus:outline-none w-52 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Dark / Light mode toggle */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
            >
              {isDarkMode
                ? <Sun size={18} className="text-amber-400" />
                : <Moon size={18} className="text-indigo-500" />}
            </button>

            {viewMode !== 'archive' && (
              <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-purple-600 hover:bg-purple-500 text-white px-3 md:px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-lg shadow-purple-600/30 transition-all active:scale-95"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">New Project</span>
              </button>
            )}
          </div>
        </header>

        {/* Board, List, or Archive View */}
        <div className="flex-1 overflow-auto p-3 md:p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-400 dark:text-zinc-600">
              <svg className="w-8 h-8 animate-spin text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <span className="text-sm font-medium tracking-wide">Loading projects...</span>
            </div>
          ) : viewMode === 'archive' ? (
            <ArchiveView projects={archivedProjects} />
          ) : viewMode === 'board' ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              {/* Horizontal scroll on mobile so columns never squish */}
              <div className="kanban-scroll flex gap-4 md:gap-6 h-full pb-4 items-start overflow-x-auto snap-x snap-mandatory md:snap-none">
                {FOCUS_ORDER.map((focus) => (
                  <ProjectColumn
                    key={focus}
                    focus={focus}
                    projects={filteredProjects.filter(p => p.daily_focus === focus)}
                    onProjectClick={(p) => setSelectedProject(p)}
                    onComplete={completeProject}
                    onQuickAdd={async (f, name) => {
                      if (!name.trim()) return;
                      await addProject({
                        project_name: name.trim(),
                        department: STATIC_DEPARTMENTS[0] || 'Compass',
                        daily_focus: f,
                        status: 'Active',
                        time_block: '15 min',
                        owner: 'TOM',
                        current_next_action: '',
                        notes: ''
                      });
                    }}
                  />
                ))}
              </div>
              <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
                {activeProject ? <DragOverlayCard project={activeProject} /> : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <ListView
              projects={filteredProjects}
              onProjectClick={(p) => setSelectedProject(p)}
              onComplete={completeProject}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {selectedProject && (
          <ProjectModal 
            project={selectedProject} 
            onClose={() => setSelectedProject(null)} 
            onSave={updateProject}
            onDelete={deleteProject}
            departments={STATIC_DEPARTMENTS}
          />
        )}
        {isCreateModalOpen && (
          <CreateProjectModal 
            onClose={() => setIsCreateModalOpen(false)} 
            onSave={addProject}
            departments={STATIC_DEPARTMENTS}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface ColumnProps {
  focus: DailyFocus;
  projects: Project[];
  onProjectClick: (p: Project) => void;
  onComplete: (id: string) => void;
  onQuickAdd: (focus: DailyFocus, name: string) => Promise<void>;
  key?: string;
}

function getDotColor(f: DailyFocus) {
  switch (f) {
    case 'Today': return 'bg-orange-500 animate-pulse';
    case 'Tomorrow': return 'bg-blue-500';
    default: return 'bg-zinc-500';
  }
}

/** Returns stoplight config for a project status, or null for Completed. */
function getStatusLight(status: ProjectStatus): {
  dot: string;
  ping: string;
  pill: string;
  borderGlow: string;
} | null {
  switch (status) {
    case 'Active':
      return {
        dot: 'bg-emerald-500',
        ping: 'bg-emerald-400',
        pill: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
        borderGlow: '',
      };
    case 'Waiting':
      return {
        dot: 'bg-amber-400',
        ping: 'bg-amber-300',
        pill: 'bg-amber-400/10 text-amber-600 dark:text-amber-400 border border-amber-400/20',
        borderGlow: '',
      };
    case 'Follow Up':
      return {
        dot: 'bg-red-500',
        ping: 'bg-red-400',
        pill: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
        borderGlow: '',
      };
    default:
      return null;
  }
}

/** Returns 'overdue' | 'today' | 'upcoming' | 'none' for traffic-light coloring.
 *
 * Uses string comparison against the local YYYY-MM-DD date to avoid the
 * UTC-parse-rollback bug: `new Date('YYYY-MM-DD')` is treated as UTC midnight,
 * which shifts to the previous calendar day in negative-offset timezones (e.g.
 * Americas). `toLocaleDateString('en-CA')` always emits YYYY-MM-DD in the
 * user's local timezone, so the comparison is always timezone-correct.
 */
function getDueDateStatus(dueDate?: string): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!dueDate?.trim()) return 'none';
  // Handle YYYY-MM-DD or YYYY-MM-DDTHH:mm strings
  const isIsoDate = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?$/.test(dueDate.trim());
  if (!isIsoDate) return 'none';
  
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA'); // always "YYYY-MM-DD"
  const dueDateOnly = dueDate.substring(0, 10);
  
  if (dueDate.length > 10) {
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
    if (dueDate < localISOTime) return 'overdue';
    if (dueDateOnly === todayStr) return 'today';
    return 'upcoming';
  } else {
    if (dueDate < todayStr) return 'overdue';
    if (dueDate === todayStr) return 'today';
    return 'upcoming';
  }
}

function ProjectColumn({ focus, projects, onProjectClick, onComplete, onQuickAdd }: ColumnProps) {
  const projectIds = projects.map(p => p.id);
  const { setNodeRef: setColumnRef, isOver } = useDroppable({ id: focus });
  const [isAdding, setIsAdding] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input whenever we enter adding mode
  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  async function handleQuickAdd() {
    if (!quickName.trim()) { setIsAdding(false); return; }
    setIsSaving(true);
    await onQuickAdd(focus, quickName);
    setQuickName('');
    setIsSaving(false);
    setIsAdding(false);
  }

  const totalMinutes = projects.reduce((acc, p) => acc + parseTimeBlockToMinutes(p.time_block), 0);
  const formattedTime = formatMinutes(totalMinutes);

  return (
    <div
      ref={setColumnRef}
      className={`kanban-column flex flex-col max-h-full rounded-2xl border transition-all ${
        isOver
          ? 'bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700 shadow-lg shadow-purple-500/10'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm'
      }`}
    >
      <div className="p-5 flex items-center justify-between shrink-0">
        <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${getDotColor(focus)}`} />
          {focus}
          <span className="ml-1 text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[8px] tracking-normal font-bold">
            {projects.length}
          </span>
        </h3>
        {totalMinutes > 0 && (
          <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500" title="Total Estimated Time">
            <Clock size={12} />
            <span className="text-[10px] font-bold tracking-wide">{formattedTime}</span>
          </div>
        )}
      </div>

      <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
        <div
          className="flex-1 overflow-y-auto px-5 space-y-3 min-h-[80px]"
          data-column-focus={focus}
        >
          {projects.length === 0 && !isAdding ? (
            <div className="h-16 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-center text-slate-300 dark:text-slate-600 text-[10px] uppercase font-bold tracking-widest select-none">
              Drop here
            </div>
          ) : (
            projects.map(project => (
              <SortableCard
                key={project.id}
                project={project}
                columnFocus={focus}
                onProjectClick={onProjectClick}
                onComplete={onComplete}
              />
            ))
          )}
        </div>
      </SortableContext>

      {/* Quick-add footer */}
      <div className="px-5 pb-4 pt-2">
        {isAdding ? (
          <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-purple-400 dark:border-purple-500 rounded-lg px-3 py-2 shadow-sm">
            <input
              ref={inputRef}
              value={quickName}
              onChange={e => setQuickName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleQuickAdd();
                if (e.key === 'Escape') { setIsAdding(false); setQuickName(''); }
              }}
              onBlur={() => { if (!quickName.trim()) { setIsAdding(false); } }}
              placeholder="Project name…"
              className="flex-1 bg-transparent border-none text-xs text-slate-900 dark:text-white focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
              disabled={isSaving}
            />
            {isSaving ? (
              <svg className="w-3 h-3 animate-spin text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : (
              <button onClick={handleQuickAdd} className="text-indigo-500 hover:text-indigo-400 text-[10px] font-bold shrink-0">↵</button>
            )}
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-600 hover:text-lime-500 dark:hover:text-lime-400 transition-colors py-2 px-1 group"
          >
            <span className="text-base leading-none group-hover:text-lime-500 dark:group-hover:text-lime-400 transition-colors">+</span>
            Add project
          </button>
        )}
      </div>
    </div>
  );
}

interface SortableCardProps {
  key?: string | number;
  project: Project;
  columnFocus: DailyFocus;
  onProjectClick: (p: Project) => void;
  onComplete: (id: string) => void;
}

/** Sortable wrapper — each project card is a draggable+droppable item */
function SortableCard({ project, columnFocus, onProjectClick, onComplete }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: project.id,
    data: { columnFocus },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectCard project={project} onProjectClick={onProjectClick} onComplete={onComplete} />
    </div>
  );
}

/** Pure card UI — shared between SortableCard and DragOverlayCard */
function ProjectCard({
  project,
  onProjectClick,
  onComplete,
}: {
  project: Project;
  onProjectClick?: (p: Project) => void;
  onComplete?: (id: string) => void;
}) {
  const dueDateStatus = getDueDateStatus(project.due_date);

  const statusLight = getStatusLight(project.status);

  return (
    <div
      className={`group relative bg-white dark:bg-slate-800 p-4 rounded-xl border-l-4 border border-slate-200 dark:border-slate-700 shadow-sm hover:border-l-lime-400 hover:shadow-lg hover:shadow-slate-200/80 dark:hover:shadow-slate-950/60 hover:-translate-y-0.5 transition-all duration-150${statusLight ? ` ${statusLight.borderGlow}` : ''}`}
    >
      {/* Completion checkmark — shown on hover, stops propagation so it doesn't open modal */}
      {onComplete && (
        <button
          onClick={(e) => { e.stopPropagation(); onComplete(project.id); }}
          title="Mark as complete"
          className="absolute top-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-all duration-150 text-zinc-300 dark:text-zinc-600 hover:text-emerald-500 dark:hover:text-emerald-400 active:text-emerald-500 hover:scale-110 active:scale-95 z-10"
        >
          <CheckCircle2 size={20} strokeWidth={1.8} />
        </button>
      )}

      <div
        onClick={() => onProjectClick?.(project)}
        className="flex flex-col gap-3 cursor-grab active:cursor-grabbing"
      >
        <div className="flex justify-between items-start gap-2 pr-5">
          <span
            className="text-[9px] font-bold px-2 py-0.5 rounded tracking-wide whitespace-nowrap"
            style={getDepartmentStyle(project.department)}
          >
            {project.department}
          </span>
          <span className="text-[9px] font-medium text-zinc-400 shrink-0">{project.time_block}</span>
        </div>

        <h4 className="font-semibold text-sm text-slate-900 dark:text-white leading-snug group-hover:text-lime-600 dark:group-hover:text-lime-400 transition-colors">
          {project.project_name}
        </h4>

        {project.current_next_action && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500 flex items-center italic">
            <svg className="w-3 h-3 mr-1.5 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
            </svg>
            <span className="truncate">{project.current_next_action}</span>
          </p>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Owner pill — who is responsible for this task */}
          <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide w-fit ${OWNER_COLORS[project.owner ?? 'TOM'] ?? OWNER_COLORS['TOM']}`}>
            {project.owner ?? 'TOM'}
          </div>

          {dueDateStatus !== 'none' && (
            <div className={`flex items-center gap-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded w-fit ${
              dueDateStatus === 'overdue'
                ? 'text-red-600 dark:text-red-500'
                : dueDateStatus === 'today'
                ? 'text-amber-500 dark:text-amber-400 animate-pulse'
                : 'text-slate-400 dark:text-slate-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                dueDateStatus === 'overdue' ? 'bg-red-600 dark:bg-red-500' :
                dueDateStatus === 'today'   ? 'bg-amber-500 dark:bg-amber-400' :
                                              'bg-slate-400'
              }`} />
              {dueDateStatus === 'overdue' ? 'Overdue · ' : dueDateStatus === 'today' ? 'Due Today · ' : 'Due: '}
              {formatDueDate(project.due_date)}
            </div>
          )}

          {/* Status stoplight badge */}
          {statusLight && (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide ${statusLight.pill}`}>
              {/* Stoplight dot with pulsing glow */}
              <span className="relative flex items-center justify-center w-2 h-2">
                <span className={`absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping ${statusLight.ping}`} />
                <span className={`relative inline-flex w-2 h-2 rounded-full ${statusLight.dot}`} />
              </span>
              {project.status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The ghost card shown under the cursor while dragging */
function DragOverlayCard({ project }: { project: Project }) {
  return (
    <div className="rotate-2 scale-105 shadow-2xl shadow-purple-500/25 opacity-95 rounded-xl">
      <ProjectCard project={project} />
    </div>
  );
}

function ListView({ projects, onProjectClick, onComplete }: { projects: Project[], onProjectClick: (p: Project) => void, onComplete: (id: string) => void }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm overflow-x-auto">
      <table className="w-full min-w-[640px] text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
            <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest w-10"></th>
            <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project Name</th>
            <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Department</th>
            <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Owner</th>
            <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Daily Focus</th>
            <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time Block</th>
            <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Due Date</th>
            <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Next Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {projects.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 dark:text-zinc-600 text-sm italic">
                No projects match your current filters.
              </td>
            </tr>
          ) : (
            projects.map(project => (
              <tr 
                key={project.id}
                className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-200 dark:border-slate-700 shadow-sm"
              >
                <td className="pl-3 pr-2 py-3">
                  <button
                    onClick={() => onComplete(project.id)}
                    title="Mark as complete"
                    className="p-2 opacity-0 group-hover:opacity-100 transition-all text-zinc-300 dark:text-zinc-600 hover:text-emerald-500 dark:hover:text-emerald-400 active:text-emerald-500 hover:scale-110 active:scale-95"
                  >
                    <CheckCircle2 size={18} strokeWidth={1.8} />
                  </button>
                </td>
                <td className="px-6 py-3" onClick={() => onProjectClick(project)}>
                  <div className="flex items-center gap-2">
                    {/* Status stoplight in list view */}
                    {(() => {
                      const sl = getStatusLight(project.status);
                      return sl ? (
                        <span className="relative flex items-center justify-center w-2 h-2 shrink-0">
                          <span className={`absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping ${sl.ping}`} />
                          <span className={`relative inline-flex w-2 h-2 rounded-full ${sl.dot}`} />
                        </span>
                      ) : null;
                    })()}
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-lime-600 dark:group-hover:text-lime-400 transition-colors cursor-pointer">
                      {project.project_name}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-3">
                  <span
                    className="text-[9px] font-bold px-2 py-0.5 rounded tracking-wide whitespace-nowrap"
                    style={getDepartmentStyle(project.department)}
                  >
                    {project.department}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide whitespace-nowrap ${OWNER_COLORS[project.owner ?? 'TOM'] ?? OWNER_COLORS['TOM']}`}>
                    {project.owner ?? 'TOM'}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {project.daily_focus}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {project.time_block}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {project.due_date ? formatDueDate(project.due_date) : '—'}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate max-w-xs italic">
                    {project.current_next_action || '—'}
                  </p>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ArchiveView({ projects }: { projects: Project[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
          <Archive size={16} className="text-purple-500" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Completed Projects</h2>
          <p className="text-xs text-zinc-400">{projects.length} project{projects.length !== 1 ? 's' : ''} completed · read-only history</p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-zinc-400 dark:text-zinc-600">
          <Archive size={36} strokeWidth={1.2} />
          <p className="text-sm font-medium">No completed projects yet.</p>
          <p className="text-xs">Mark a project as done and it will appear here.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm overflow-x-auto">
          <table className="w-full min-w-[600px] text-left border-collapse">
            <thead>
          <tr className="bg-purple-50 dark:bg-purple-950/20 border-b border-purple-100 dark:border-purple-900/30">
            <th className="px-6 py-4 text-[10px] font-bold text-purple-500 uppercase tracking-widest">Project Name</th>
            <th className="px-6 py-4 text-[10px] font-bold text-purple-500 uppercase tracking-widest">Department</th>
            <th className="px-6 py-4 text-[10px] font-bold text-purple-500 uppercase tracking-widest">Owner</th>
            <th className="px-6 py-4 text-[10px] font-bold text-purple-500 uppercase tracking-widest">Focus</th>
            <th className="px-6 py-4 text-[10px] font-bold text-purple-500 uppercase tracking-widest">Time Block</th>
            <th className="px-6 py-4 text-[10px] font-bold text-purple-500 uppercase tracking-widest">Last Action</th>
            <th className="px-6 py-4 text-[10px] font-bold text-purple-500 uppercase tracking-widest">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {projects.map(project => (
                <tr key={project.id} className="opacity-70 hover:opacity-100 transition-opacity">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 line-through decoration-zinc-300 dark:decoration-zinc-600">
                        {project.project_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className="text-[9px] font-bold px-2 py-0.5 rounded tracking-wide whitespace-nowrap opacity-60"
                      style={getDepartmentStyle(project.department)}
                    >
                      {project.department}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide whitespace-nowrap opacity-60 ${OWNER_COLORS[project.owner ?? 'TOM'] ?? OWNER_COLORS['TOM']}`}>
                      {project.owner ?? 'TOM'}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{project.daily_focus}</span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{project.time_block}</span>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate max-w-xs italic">
                      {project.current_next_action || '—'}
                    </p>
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                      {project.completed_at
                        ? new Date(project.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ProjectModalProps = {
  project: Project;
  onClose: () => void;
  onSave: (p: Project) => void;
  onDelete: (id: string) => void;
  departments: string[];
};

function ProjectModal({ project, onClose, onSave, onDelete, departments }: ProjectModalProps) {
  const [edited, setEdited] = useState<Project>(project);
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  // Configure marked for safe link rendering
  marked.setOptions({ breaks: true, gfm: true } as object);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <motion.div
        layoutId={project.id}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[450px] h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col z-50 dark:text-slate-100"
      >
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Project Details</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Project Name</label>
            <textarea 
              value={edited.project_name} 
              onChange={e => setEdited({...edited, project_name: e.target.value})}
              className="w-full text-xl font-bold bg-transparent border-none p-0 focus:ring-0 focus:outline-none resize-none text-zinc-900 dark:text-white leading-tight"
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Department</label>
              <select
                value={edited.department}
                onChange={e => setEdited({...edited, department: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Time Block</label>
              <select 
                value={edited.time_block}
                onChange={e => setEdited({...edited, time_block: e.target.value as TimeBlock})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                <option value="5 min">5 min</option>
                <option value="15 min">15 min</option>
                <option value="30 min">30 min</option>
                <option value="1 hour">1 hour</option>
                <option value="2 hours">2 hours</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Daily Focus</label>
              <select
                value={edited.daily_focus}
                onChange={e => setEdited({...edited, daily_focus: e.target.value as DailyFocus})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                {FOCUS_ORDER.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block tracking-widest">Status</label>
                {/* Live stoplight dot — updates as user changes status */}
                {(() => {
                  const sl = getStatusLight(edited.status);
                  return sl ? (
                    <span className="relative flex items-center justify-center w-2.5 h-2.5">
                      <span className={`absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping ${sl.ping}`} />
                      <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${sl.dot}`} />
                    </span>
                  ) : null;
                })()}
              </div>
              <select 
                value={edited.status}
                onChange={e => setEdited({...edited, status: e.target.value as ProjectStatus})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                <option value="Active">Active</option>
                <option value="Waiting">Waiting</option>
                <option value="Follow Up">Follow Up</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Due Date</label>
              <input
                type="datetime-local"
                value={edited.due_date || ''}
                onChange={e => setEdited({...edited, due_date: e.target.value})}
                placeholder="No date set"
                className="w-full bg-transparent dark:bg-slate-700 border-none dark:border dark:border-slate-600 rounded px-1 py-1 text-xs font-semibold text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-slate-400 focus:ring-0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Owner</label>
              <select
                value={edited.owner ?? 'TOM'}
                onChange={e => setEdited({...edited, owner: e.target.value as Owner})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                {OWNER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Current Next Action</label>
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <textarea 
                value={edited.current_next_action || ''}
                onChange={e => setEdited({...edited, current_next_action: e.target.value})}
                className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 focus:outline-none resize-none text-slate-700 dark:text-white"
                rows={2}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Notes</label>
              <button
                onClick={() => setIsEditingNotes(v => !v)}
                className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors text-zinc-400 hover:text-indigo-500 dark:hover:text-indigo-400 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-400"
              >
                {isEditingNotes ? 'Preview' : 'Edit'}
              </button>
            </div>
            {isEditingNotes ? (
              <textarea
                autoFocus
                value={edited.notes || ''}
                onChange={e => setEdited({...edited, notes: e.target.value})}
                placeholder="Supports **bold**, *italic*, - bullet lists, and [links](url)..."
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none resize-none text-slate-700 dark:text-white min-h-[140px] font-mono"
              />
            ) : (
              <div
                className="min-h-[80px] text-sm text-slate-600 dark:text-slate-300 markdown-body cursor-text p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                onClick={() => setIsEditingNotes(true)}
                dangerouslySetInnerHTML={{
                  __html: edited.notes?.trim()
                    ? marked.parse(edited.notes) as string
                    : '<span class="text-zinc-400 italic text-xs">Click to add notes… (supports Markdown)</span>'
                }}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Support Link</label>
            <div className="flex items-center gap-2">
              <input 
                type="url"
                value={edited.support_link || ''}
                onChange={e => setEdited({...edited, support_link: e.target.value})}
                className="flex-1 bg-transparent border-none p-0 text-xs text-indigo-600 dark:text-indigo-400 focus:ring-0 truncate"
                placeholder="https://..."
              />
              {edited.support_link && (
                <a href={edited.support_link} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-indigo-600 transition-colors">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex gap-3 bg-slate-50 dark:bg-slate-900">
          <button 
            onClick={() => onDelete(edited.id)}
            className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400 rounded-lg text-sm font-semibold transition-all text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
          >
            Delete
          </button>
          <button 
            onClick={() => onSave(edited)}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-purple-600/25 active:scale-95"
          >
            Save Changes
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CreateProjectModal({ onClose, onSave, departments }: { 
  onClose: () => void, 
  onSave: (p: Omit<Project, 'id'>) => Promise<boolean>,
  departments: string[]
}) {
  const initialForm: Omit<Project, 'id'> = {
    project_name: '',
    department: departments[0] || 'Compass',
    daily_focus: 'Today',
    status: 'Active',
    time_block: '15 min',
    owner: 'TOM',
    current_next_action: '',
    notes: '',
    due_date: '',
    support_link: '',
  };
  const [form, setForm] = useState<Omit<Project, 'id'>>(initialForm);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Configure marked for safe link rendering
  marked.setOptions({ breaks: true, gfm: true } as object);

  async function handleCreate() {
    if (!form.project_name.trim()) return;
    setIsSaving(true);
    try {
      const success = await onSave(form);
      if (success) {
        // Reset form — modal will be closed by the parent via setIsCreateModalOpen(false)
        setForm(initialForm);
        setIsEditingNotes(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ scale: 0.98, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.98, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden z-10 border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] dark:text-slate-100"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">New Project</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* Project Name — full width, large */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block tracking-widest">Project Name</label>
            <input
              autoFocus
              type="text"
              required
              placeholder="What are we focusing on?"
              value={form.project_name}
              onChange={e => setForm({...form, project_name: e.target.value})}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>

          {/* Row: Department | Time Block */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block tracking-widest">Department</label>
              <select
                value={form.department}
                onChange={e => setForm({...form, department: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs font-semibold appearance-none text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block tracking-widest">Time Block</label>
              <select
                value={form.time_block}
                onChange={e => setForm({...form, time_block: e.target.value as TimeBlock})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs font-semibold appearance-none text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                <option value="5 min">5 min</option>
                <option value="15 min">15 min</option>
                <option value="30 min">30 min</option>
                <option value="1 hour">1 hour</option>
                <option value="2 hours">2 hours</option>
              </select>
            </div>
          </div>

          {/* Row: Daily Focus | Status */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block tracking-widest">Daily Focus</label>
              <select
                value={form.daily_focus}
                onChange={e => setForm({...form, daily_focus: e.target.value as DailyFocus})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs font-semibold appearance-none text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                {FOCUS_ORDER.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block tracking-widest">Status</label>
              <select
                value={form.status}
                onChange={e => setForm({...form, status: e.target.value as ProjectStatus})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs font-semibold appearance-none text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                <option value="Active">Active</option>
                <option value="Waiting">Waiting</option>
                <option value="Follow Up">Follow Up</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          {/* Row: Due Date | Owner */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Due Date</label>
              <input
                type="datetime-local"
                value={form.due_date || ''}
                onChange={e => setForm({...form, due_date: e.target.value})}
                className="w-full bg-zinc-50 dark:bg-slate-700 border border-zinc-200 dark:border-slate-600 rounded-lg p-3 text-xs font-semibold text-zinc-900 dark:text-white outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Owner</label>
              <select
                value={form.owner ?? 'TOM'}
                onChange={e => setForm({...form, owner: e.target.value as Owner})}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs font-semibold appearance-none text-slate-900 dark:text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
              >
                {OWNER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Current Next Action — full width */}
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Current Next Action</label>
            <div className="p-3 bg-zinc-50 dark:bg-slate-700 rounded-lg border border-zinc-200 dark:border-slate-600">
              <textarea
                value={form.current_next_action || ''}
                onChange={e => setForm({...form, current_next_action: e.target.value})}
                placeholder="First physical next step…"
                className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 focus:outline-none resize-none text-zinc-700 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-slate-400"
                rows={2}
              />
            </div>
          </div>

          {/* Notes — markdown editor/preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Notes</label>
              <button
                type="button"
                onClick={() => setIsEditingNotes(v => !v)}
                className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors text-zinc-400 hover:text-indigo-500 dark:hover:text-indigo-400 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-400"
              >
                {isEditingNotes ? 'Preview' : 'Edit'}
              </button>
            </div>
            {isEditingNotes ? (
              <textarea
                autoFocus
                value={form.notes || ''}
                onChange={e => setForm({...form, notes: e.target.value})}
                placeholder="Supports **bold**, *italic*, - bullet lists, and [links](url)..."
                className="w-full bg-zinc-50 dark:bg-slate-700 border border-zinc-200 dark:border-slate-600 rounded-lg p-3 text-sm focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none text-zinc-700 dark:text-white min-h-[120px] font-mono"
              />
            ) : (
              <div
                className="min-h-[60px] text-sm text-zinc-600 dark:text-zinc-300 markdown-body cursor-text p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                onClick={() => setIsEditingNotes(true)}
                dangerouslySetInnerHTML={{
                  __html: form.notes?.trim()
                    ? marked.parse(form.notes) as string
                    : '<span class="text-zinc-400 italic text-xs">Click to add notes… (supports Markdown)</span>'
                }}
              />
            )}
          </div>

          {/* Support Link — full width */}
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 block tracking-widest">Support Link</label>
            <div className="flex items-center gap-2 p-3 bg-zinc-50 dark:bg-slate-700 rounded-lg border border-zinc-200 dark:border-slate-600">
              <input
                type="url"
                value={form.support_link || ''}
                onChange={e => setForm({...form, support_link: e.target.value})}
                placeholder="https://..."
                className="flex-1 bg-transparent border-none p-0 text-xs text-indigo-600 dark:text-indigo-400 focus:ring-0 outline-none truncate"
              />
              {form.support_link && (
                <a href={form.support_link} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-indigo-600 transition-colors shrink-0">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-50 dark:bg-slate-900 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            disabled={!form.project_name.trim() || isSaving}
            onClick={handleCreate}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-lg text-sm font-bold active:scale-95 transition-all shadow-lg shadow-purple-600/25 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Saving…
              </>
            ) : 'Create Project'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
