/**
 * Role-Based Access Control (RBAC) Service
 * Manages user roles and permissions for the soil sampling platform
 */

import type { UserRole } from '../types';
import { auth } from '../firebase';
import { firebaseGPS } from './firebaseSync';

export interface UserWithRole {
  uid: string;
  email: string;
  role: UserRole;
  organization_id?: string;
  displayName?: string;
  created_at: string;
  lastActive: string;
}

export interface Permission {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'export';
  granted: boolean;
}

/**
 * Role permissions matrix
 * Defines what each role can do
 */
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: [
    'users:*',
    'projects:*',
    'samples:*',
    'exports:*',
    'organizations:*',
    'settings:*'
  ],
  consultant: [
    'projects:read',
    'projects:create',
    'projects:update',
    'samples:read',
    'samples:create',
    'samples:update',
    'exports:create',
    'exports:read',
    'users:read' // Can view users in their organization
  ],
  client: [
    'projects:read',
    'samples:read',
    'exports:read'
  ],
  lab_manager: [
    'exports:read',
    'exports:create',
    'samples:read',
    'samples:update', // Can update lab-related fields only
    'projects:read'
  ],
  technician: [
    'projects:read',
    'samples:create',
    'samples:read',
    'samples:update'
  ]
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, resource: string, action: string): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  
  // Check for exact match
  const permissionKey = `${resource}:${action}`;
  if (permissions.includes(permissionKey)) {
    return true;
  }
  
  // Check for wildcard match
  const wildcardKey = `${resource}:*`;
  if (permissions.includes(wildcardKey)) {
    return true;
  }
  
  return false;
}

/**
 * Get user role from Firestore
 */
export async function getUserRole(uid: string): Promise<UserRole | null> {
  try {
    const userDoc = await firebaseGPS.getUserDocument(uid);
    return (userDoc?.role as UserRole) || null;
  } catch (error) {
    console.error('Error fetching user role:', error);
    return null;
  }
}

/**
 * Get current user's role
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
  const user = auth.currentUser;
  if (!user) return null;
  
  return getUserRole(user.uid);
}

/**
 * Check if current user has permission
 */
export async function currentUserCan(resource: string, action: string): Promise<boolean> {
  const role = await getCurrentUserRole();
  if (!role) return false;
  
  return hasPermission(role, resource, action);
}

/**
 * Update user role (admin only)
 */
export async function updateUserRole(uid: string, role: UserRole): Promise<void> {
  // Check if current user is admin
  const currentRole = await getCurrentUserRole();
  if (currentRole !== 'admin') {
    throw new Error('Only administrators can update user roles');
  }
  
  try {
    await firebaseGPS.updateUserRole(uid, role);
  } catch (error: any) {
    console.error('Error updating user role:', error);
    throw new Error(`Failed to update user role: ${error.message}`);
  }
}

/**
 * Get human-readable role name
 */
export function getRoleName(role: UserRole): string {
  const roleNames: Record<UserRole, string> = {
    admin: 'Administrator',
    client: 'Client',
    consultant: 'Consultant',
    lab_manager: 'Lab Manager',
    technician: 'Technician'
  };
  return roleNames[role] || role;
}

/**
 * Get role description
 */
export function getRoleDescription(role: UserRole): string {
  const descriptions: Record<UserRole, string> = {
    admin: 'Full system access, can manage users and organizations',
    client: 'View projects and samples, download exports',
    consultant: 'Create and manage projects, perform sampling, export data',
    lab_manager: 'Manage laboratory exports and sample analysis data',
    technician: 'Perform field sampling and data entry'
  };
  return descriptions[role] || '';
}

/**
 * Get all available roles
 */
export function getAllRoles(): UserRole[] {
  return ['admin', 'consultant', 'lab_manager', 'technician', 'client'];
}

/**
 * Validate if a user can access another user's data
 */
export async function canAccessUserData(
  currentUserId: string,
  targetUserId: string
): Promise<boolean> {
  // User can always access their own data
  if (currentUserId === targetUserId) {
    return true;
  }
  
  const currentRole = await getUserRole(currentUserId);
  
  // Admins can access anyone's data
  if (currentRole === 'admin') {
    return true;
  }
  
  // Check if users are in the same organization
  const currentUser = await firebaseGPS.getUserDocument(currentUserId);
  const targetUser = await firebaseGPS.getUserDocument(targetUserId);
  
  if (
    currentUser?.organization_id &&
    targetUser?.organization_id &&
    currentUser.organization_id === targetUser.organization_id
  ) {
    // Consultants can access data from their organization
    if (currentRole === 'consultant') {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if user can export samples
 */
export async function canExportSamples(): Promise<boolean> {
  return await currentUserCan('exports', 'create');
}

/**
 * Check if user can manage users
 */
export async function canManageUsers(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === 'admin';
}

/**
 * Check if user can create projects
 */
export async function canCreateProjects(): Promise<boolean> {
  return await currentUserCan('projects', 'create');
}

/**
 * Get permissions for a role
 */
export function getRolePermissions(role: UserRole): Permission[] {
  const permissions: Permission[] = [];
  const rolePerms = ROLE_PERMISSIONS[role] || [];
  
  // Parse permissions into structured format
  const resources = ['users', 'projects', 'samples', 'exports', 'organizations', 'settings'];
  const actions: Array<'create' | 'read' | 'update' | 'delete' | 'export'> = [
    'create',
    'read',
    'update',
    'delete',
    'export'
  ];
  
  for (const resource of resources) {
    for (const action of actions) {
      permissions.push({
        resource,
        action,
        granted: hasPermission(role, resource, action)
      });
    }
  }
  
  return permissions;
}
