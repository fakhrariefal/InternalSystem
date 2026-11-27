import type { AppModule, UserRole } from './types';

export type PermissionAction =
  | 'master:write'
  | 'supplier:write'
  | 'buyer:write'
  | 'partner:approve'
  | 'master:users'
  | 'po:create'
  | 'po:approve'
  | 'director:approve'
  | 'po:receive'
  | 'po:close'
  | 'rfq:write'
  | 'inventory:write'
  | 'so:create'
  | 'so:deliver'
  | 'quotation:write'
  | 'return:write'
  | 'accounting:write'
  | 'period:close'
  | 'budget:write'
  | 'reports:export'
  | 'system:settings';

export const ALL_ROLES: UserRole[] = [
  'Direktur',
  'Manager',
  'Purchasing',
  'Warehouse',
  'Sales',
  'Finance',
  'Viewer',
  'Angel Investor',
];

export function normalizeUserRole(role: string | undefined | null): UserRole {
  const trimmed = (role || '').trim();
  if (!trimmed) return 'Viewer';
  if (trimmed.toLowerCase() === 'super admin') return 'Direktur';
  if (trimmed.toLowerCase() === 'anggel investor') return 'Angel Investor';
  const matched = ALL_ROLES.find((r) => r.toLowerCase() === trimmed.toLowerCase());
  return matched || 'Viewer';
}

const ROLE_PERMISSIONS: Record<UserRole, Set<PermissionAction>> = {
  Direktur: new Set([
    'master:write',
    'supplier:write',
    'buyer:write',
    'partner:approve',
    'master:users',
    'po:create',
    'po:approve',
    'director:approve',
    'po:receive',
    'po:close',
    'rfq:write',
    'inventory:write',
    'so:create',
    'so:deliver',
    'quotation:write',
    'return:write',
    'accounting:write',
    'period:close',
    'budget:write',
    'reports:export',
    'system:settings',
  ]),
  Manager: new Set([
    'master:write',
    'supplier:write',
    'buyer:write',
    'po:create',
    'po:approve',
    'po:close',
    'rfq:write',
    'so:create',
    'quotation:write',
    'return:write',
    'accounting:write',
    'period:close',
    'budget:write',
    'reports:export',
    'system:settings',
  ]),
  Purchasing: new Set(['master:write', 'supplier:write', 'po:create', 'rfq:write', 'return:write', 'reports:export']),
  Warehouse: new Set(['master:write', 'po:receive', 'inventory:write', 'so:deliver', 'return:write', 'reports:export']),
  Sales: new Set(['master:write', 'buyer:write', 'so:create', 'quotation:write', 'return:write', 'reports:export']),
  Finance: new Set(['po:close', 'return:write', 'accounting:write', 'period:close', 'budget:write', 'reports:export']),
  Viewer: new Set([]),
  'Angel Investor': new Set([]),
};

const OPERATIONAL_ROLES: UserRole[] = ALL_ROLES.filter((r) => r !== 'Angel Investor');

export const MODULE_ACCESS: Record<AppModule, UserRole[]> = {
  dashboard: ALL_ROLES,
  master: OPERATIONAL_ROLES,
  purchasing: OPERATIONAL_ROLES,
  inventory: OPERATIONAL_ROLES,
  sales: OPERATIONAL_ROLES,
  accounting: OPERATIONAL_ROLES,
  reports: OPERATIONAL_ROLES,
  system: OPERATIONAL_ROLES,
};

export function hasPermission(role: UserRole | string | undefined, action: PermissionAction): boolean {
  if (!role) return false;
  const normalized = normalizeUserRole(role);
  return ROLE_PERMISSIONS[normalized]?.has(action) ?? false;
}

export function canAccessModule(role: UserRole | string | undefined, module: AppModule): boolean {
  if (!role) return false;
  const normalized = normalizeUserRole(role);
  return MODULE_ACCESS[module]?.includes(normalized) ?? false;
}

export function getRoleDescription(role: UserRole | string): string {
  switch (normalizeUserRole(role)) {
    case 'Direktur':
      return 'Kendali penuh: Approve (Verified) Supplier, set Credit Limit Buyer tempo & manajemen user';
    case 'Manager':
      return 'Approval Purchase Order, pengawasan operasional & laporan';
    case 'Purchasing':
      return 'Registrasi awal Supplier (status Pending) & pembuatan Purchase Order';
    case 'Warehouse':
      return 'Gudang/Operasional: Terima & kirim barang, akses baca alamat kirim & PIC lapangan untuk Surat Jalan';
    case 'Sales':
      return 'Registrasi awal Buyer/Klien (status Pending) & pembuatan Sales Order';
    case 'Finance':
      return 'Hutang supplier (AP), piutang customer (AR) & pencatatan pembayaran';
    case 'Viewer':
      return 'Akses lihat saja (read-only) tanpa hak ubah data';
    case 'Angel Investor':
      return 'Investor / Pemegang Saham: hanya dapat melihat Beranda Eksekutif (Dashboard), menu lain tidak ditampilkan';
  }
}
