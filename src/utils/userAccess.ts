export type UserAccessShape = {
  accessDisabled?: boolean | null;
  accessDisabledAt?: unknown;
  accessExpiresAt?: unknown;
};

export type UserAccessStatus = 'active' | 'disabled' | 'expired';

export type UserAccessState = {
  status: UserAccessStatus;
  blocked: boolean;
  accessDisabled: boolean;
  disabledAt: string | null;
  expiresAt: string | null;
};

const padDatePart = (value: number): string => value.toString().padStart(2, '0');

export const normalizeAccessTimestamp = (value: unknown): string | null => {
  if (!value) return null;

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof (value as { toDate?: () => Date })?.toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === 'object' && value !== null) {
    const timestampValue = value as { seconds?: number; nanoseconds?: number };
    if (typeof timestampValue.seconds === 'number') {
      return new Date(timestampValue.seconds * 1000).toISOString();
    }
  }

  return null;
};

export const toAccessDateInputValue = (value: unknown): string => {
  const normalized = normalizeAccessTimestamp(value);
  if (!normalized) return '';

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '';

  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
};

export const fromAccessDateInputValue = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const [yearPart, monthPart, dayPart] = trimmed.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const getUserAccessSnapshot = (profile?: UserAccessShape | null): UserAccessShape => ({
  accessDisabled: Boolean(profile?.accessDisabled),
  accessDisabledAt: normalizeAccessTimestamp(profile?.accessDisabledAt),
  accessExpiresAt: normalizeAccessTimestamp(profile?.accessExpiresAt)
});

export const getUserAccessState = (
  profile?: UserAccessShape | null,
  now: number = Date.now()
): UserAccessState => {
  const accessDisabled = Boolean(profile?.accessDisabled);
  const disabledAt = normalizeAccessTimestamp(profile?.accessDisabledAt);
  const expiresAt = normalizeAccessTimestamp(profile?.accessExpiresAt);

  if (accessDisabled) {
    return {
      status: 'disabled',
      blocked: true,
      accessDisabled,
      disabledAt,
      expiresAt
    };
  }

  if (expiresAt) {
    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isNaN(expiresAtMs) && now > expiresAtMs) {
      return {
        status: 'expired',
        blocked: true,
        accessDisabled: false,
        disabledAt,
        expiresAt
      };
    }
  }

  return {
    status: 'active',
    blocked: false,
    accessDisabled: false,
    disabledAt,
    expiresAt
  };
};

export const getDaysUntilAccessExpiry = (
  profile?: UserAccessShape | null,
  now: number = Date.now()
): number | null => {
  const expiresAt = normalizeAccessTimestamp(profile?.accessExpiresAt);
  if (!expiresAt) return null;

  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) return null;

  return Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000));
};

export const isUserAccessExpiringSoon = (
  profile?: UserAccessShape | null,
  withinDays: number = 30,
  now: number = Date.now()
): boolean => {
  const accessState = getUserAccessState(profile, now);
  if (accessState.status !== 'active' || !accessState.expiresAt) {
    return false;
  }

  const daysUntilExpiry = getDaysUntilAccessExpiry(profile, now);
  return daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= withinDays;
};

export const extendAccessExpiry = (
  value: unknown,
  extension: { days?: number; months?: number; years?: number },
  now: number = Date.now()
): string => {
  const normalized = normalizeAccessTimestamp(value);
  const currentExpiryMs = normalized ? new Date(normalized).getTime() : Number.NaN;
  const baseDate = !Number.isNaN(currentExpiryMs) && currentExpiryMs > now
    ? new Date(currentExpiryMs)
    : new Date(now);

  if (extension.days) {
    baseDate.setDate(baseDate.getDate() + extension.days);
  }
  if (extension.months) {
    baseDate.setMonth(baseDate.getMonth() + extension.months);
  }
  if (extension.years) {
    baseDate.setFullYear(baseDate.getFullYear() + extension.years);
  }

  baseDate.setHours(23, 59, 59, 999);
  return baseDate.toISOString();
};