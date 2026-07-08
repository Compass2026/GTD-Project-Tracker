import { useEffect, useRef } from 'react';
import { Project } from '../types';

export function useNotifications(projects: Project[]) {
  const notifiedUpcomingRefs = useRef<Set<string>>(new Set());
  const notifiedReachedRefs = useRef<Set<string>>(new Set());

  const requestPermission = async () => {
    if (!('Notification' in window)) return false;
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  };

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const checkDeadlines = () => {
      const now = new Date();
      
      projects.forEach((project) => {
        if (!project.due_date || project.status === 'Completed') return;
        
        const dueDate = new Date(project.due_date);
        const timeUntil = dueDate.getTime() - now.getTime();
        
        // 1. Upcoming alert (1 hour before)
        if (timeUntil > 0 && timeUntil <= 3600000 && !notifiedUpcomingRefs.current.has(project.id)) {
          new Notification('Upcoming Deadline', {
            body: `Project "${project.project_name}" is due in 1 hour!`,
            icon: '/compass-icon.svg'
          });
          notifiedUpcomingRefs.current.add(project.id);
        }

        // 2. Reached alert (at deadline or overdue)
        if (timeUntil <= 0 && !notifiedReachedRefs.current.has(project.id)) {
          new Notification('Deadline Reached!', {
            body: `The deadline for "${project.project_name}" has passed.`,
            icon: '/compass-icon.svg',
            requireInteraction: true 
          });
          notifiedReachedRefs.current.add(project.id);
        }
      });
    };

    const interval = setInterval(checkDeadlines, 30000); // Check every 30 seconds for better precision
    checkDeadlines(); 

    return () => clearInterval(interval);
  }, [projects]);

  return { requestPermission, permissionStatus: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported' };
}
