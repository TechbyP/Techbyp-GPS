import { useState, useCallback, useRef } from 'react';
import { GpsProject } from '../types';
import { hybridDB } from '../services/hybridDatabase';
import { useAuth } from '../context/AuthContext';

export function useProjectState() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<GpsProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<GpsProject | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const loadProjectsAbortController = useRef<AbortController | null>(null);

  const loadProjects = useCallback(async () => {
    // Abort any existing loading operation
    if (loadProjectsAbortController.current) {
      loadProjectsAbortController.current.abort();
    }
    
    // Create new abort controller for this operation
    loadProjectsAbortController.current = new AbortController();
    const { signal } = loadProjectsAbortController.current;
    
    if (isLoadingProjects) {
      return;
    }
    
    try {
      setIsLoadingProjects(true);
      
      if (signal.aborted) return;

      const isOffline = !navigator.onLine;
      
      // Ensure user ID is set
      if (user?.uid) {
        await hybridDB.setUserId(user.uid);
      } else {
        console.warn('No user UID available');
        return;
      }
      
      if (signal.aborted) return;
      
      let projectList = await hybridDB.getProjects() as GpsProject[];
      
      // Filter valid projects
      projectList = projectList.filter(p => p && (p.id || p.name) && typeof p === 'object');
      
      if (projectList.length === 0 && !isOffline) {
        // Wait for potential sync
        await new Promise(resolve => setTimeout(resolve, 2000));
        const recheckProjects = await hybridDB.getProjects() as GpsProject[];
        
        if (recheckProjects.length > 0 && !signal.aborted) {
          const validProjects = recheckProjects.filter(p => p && (p.id || p.name));
          setProjects(validProjects);
          const mostRecentProject = validProjects.reduce((latest: GpsProject, current: GpsProject) => {
            const latestTime = new Date(latest.updated_at || latest.created_at).getTime();
            const currentTime = new Date(current.updated_at || current.created_at).getTime();
            return currentTime > latestTime ? current : latest;
          }, validProjects[0]);
          setSelectedProject(mostRecentProject);
          return;
        }
      }
      
      if (signal.aborted) return;
      
      setProjects(projectList);
      
      if (projectList.length > 0) {
        const mostRecentProject = projectList.reduce((latest: GpsProject, current: GpsProject) => {
          if (!latest || !current) return latest || current;
          const latestTime = new Date(latest.updated_at || latest.created_at || 0).getTime();
          const currentTime = new Date(current.updated_at || current.created_at || 0).getTime();
          return currentTime > latestTime ? current : latest;
        }, projectList[0]);
        
        if (mostRecentProject?.id && !signal.aborted) {
          setSelectedProject(mostRecentProject);
        }
      } else {
        setSelectedProject(null);
      }
      
    } catch (error) {
      console.error('Error loading projects:', error);
      setProjects([]);
      setSelectedProject(null);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [user?.uid, isLoadingProjects]);

  // Note: Removed sync-complete event listener to prevent infinite loops
  // Background sync now runs silently and UI updates on next manual refresh

  const createProject = useCallback(async (name: string, description: string = '') => {
    if (!name.trim()) {
      throw new Error('Project name is required');
    }

    const newProject = await hybridDB.createProject(name, description);
    setProjects(prev => [...prev, newProject]);
    setSelectedProject(newProject);
    return newProject;
  }, []);

  const deleteProject = useCallback(async (projectId: string | number) => {
    await hybridDB.deleteProject(projectId.toString());
    await loadProjects(); // Reload to ensure sync
  }, [loadProjects]);

  const updateProject = useCallback(async (projectId: string | number, name: string, description: string = '') => {
    await hybridDB.updateProject(projectId.toString(), name, description);
    
    // Update local state
    const updatedProjects = projects.map(p => 
      p.id === projectId 
        ? { ...p, name, description }
        : p
    );
    setProjects(updatedProjects);
    
    if (selectedProject?.id === projectId) {
      setSelectedProject({ ...selectedProject, name, description });
    }
  }, [projects, selectedProject]);

  const cleanup = useCallback(() => {
    if (loadProjectsAbortController.current) {
      loadProjectsAbortController.current.abort();
    }
  }, []);

  return {
    projects,
    selectedProject,
    setSelectedProject,
    isLoadingProjects,
    loadProjects,
    createProject,
    deleteProject,
    updateProject,
    cleanup
  };
}