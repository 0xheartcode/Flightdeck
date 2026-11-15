import { z } from 'zod';
import type { Permission } from '../identity.js';

/**
 * Local user roles. These are Flightdeck's own roles for the self-managed
 * (no-external-IdP) auth path, and map directly to the view/act/reveal
 * permission model:
 *   - viewer:   read-only (view)
 *   - operator: can trigger actions (view, act)
 *   - admin:    full access incl. revealing secrets and managing users/tokens
 *               (view, act, reveal)
 */
export const ROLES = ['viewer', 'operator', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** Minimum password length for a local user. */
export const MIN_PASSWORD_LENGTH = 10;

/** Map a set of local roles to concrete permissions (highest role wins). */
export function permissionsForRoles(roles: Role[]): Set<Permission> {
  const perms = new Set<Permission>(['view']);
  if (roles.includes('operator') || roles.includes('admin')) perms.add('act');
  if (roles.includes('admin')) perms.add('reveal');
  return perms;
}

/** A local user as returned by the API. Never includes the password hash. */
export const User = z.object({
  id: z.string(),
  username: z.string(),
  roles: z.array(Role),
  disabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastLoginAt: z.number().nullable(),
});
export type User = z.infer<typeof User>;

const username = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, underscore or hyphen only');
const password = z.string().min(MIN_PASSWORD_LENGTH).max(256);

export const CreateUserInput = z.object({
  username,
  password,
  roles: z.array(Role).min(1),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

/** Patch roles and/or the disabled flag of an existing user. */
export const UpdateUserInput = z.object({
  roles: z.array(Role).min(1).optional(),
  disabled: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

export const SetPasswordInput = z.object({ password });
export type SetPasswordInput = z.infer<typeof SetPasswordInput>;

export const LoginInput = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;
