import { useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { Project } from '../types';
import { generateICS } from '../utils';

export function useCalendarSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const syncCalendar = useCallback(async (projects: Project[]) => {
    try {
      setIsSyncing(true);
      
      // 1. Generate ICS content for all active projects
      const activeProjects = projects.filter(p => p.status !== 'Completed' && p.due_date);
      if (activeProjects.length === 0) {
        console.log('[CalendarSync] No active projects with deadlines to sync.');
        return null;
      }

      const icsContent = generateICS(activeProjects);
      const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
      const file = new File([blob], 'compass-deadlines.ics', { type: 'text/calendar' });

      // 2. Upload to Supabase Storage
      // We use upsert: true to overwrite the existing file
      const { data, error } = await supabase.storage
        .from('calendars')
        .upload('compass-deadlines.ics', file, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        // If bucket doesn't exist, this will fail. 
        // We'll catch it and log a helpful message for the user.
        console.error('[CalendarSync] Upload error:', error);
        throw error;
      }

      // 3. Get Public URL
      const { data: { publicUrl } } = supabase.storage
        .from('calendars')
        .getPublicUrl('compass-deadlines.ics');

      setLastSync(new Date());
      console.log('[CalendarSync] Successfully synced to:', publicUrl);
      return publicUrl;

    } catch (err) {
      console.error('[CalendarSync] Sync failed:', err);
      return null;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const getCalendarUrl = useCallback(() => {
    const { data: { publicUrl } } = supabase.storage
      .from('calendars')
      .getPublicUrl('compass-deadlines.ics');
    
    // Replace https with webcal for direct subscription opening
    return publicUrl.replace(/^https:/, 'webcal:');
  }, []);

  return { syncCalendar, isSyncing, lastSync, getCalendarUrl };
}
