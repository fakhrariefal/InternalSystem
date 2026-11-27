import {
  BarChart3,
  Bell,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  ShoppingCart,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import type { AuthMode } from '../controllers/useErpController';
import { MODULE_LABELS, useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';
import { ALL_ROLES, canAccessModule } from '../models/rbac';
import type { AppModule, AppNotification, CompanySettings, UserProfile, UserRole } from '../models/types';
import { Button, NativeSelect } from './ui/primitives';

interface AppShellProps {
  user: UserProfile;
  authMode: AuthMode;
  settings: CompanySettings;
  activeModule: AppModule;
  onSelectModule: (mod: AppModule) => void;
  notifications: AppNotification[];
  onMarkNotifRead: (id: string) => void;
  onSwitchPreviewRole: (role: UserRole) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: AppModule;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'master', icon: Database },
  { id: 'purchasing', icon: ShoppingCart },
  { id: 'inventory', icon: Boxes },
  { id: 'sales', icon: ClipboardList },
  { id: 'accounting', icon: ReceiptText },
  { id: 'reports', icon: BarChart3 },
  { id: 'system', icon: Settings },
];

const MOBILE_PRIMARY_TABS: Array<{
  id: AppModule;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'purchasing', icon: ShoppingCart },
  { id: 'sales', icon: ClipboardList },
  { id: 'accounting', icon: ReceiptText },
];

export function AppShell({
  user,
  authMode,
  settings,
  activeModule,
  onSelectModule,
  notifications,
  onMarkNotifRead,
  onSwitchPreviewRole,
  onLogout,
  children,
}: AppShellProps) {
  const { lang, setLang, tr } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const accessibleNavItems = NAV_ITEMS.filter((item) => canAccessModule(user.role, item.id));
  const accessibleMobileTabs = MOBILE_PRIMARY_TABS.filter((tab) =>
    canAccessModule(user.role, tab.id)
  );
  const showMobileBottomNav = accessibleNavItems.length > 1 && accessibleMobileTabs.length > 0;

  const visibleNotifications = notifications.filter(
    (n) =>
      (!n.targetRoles || n.targetRoles.length === 0 || n.targetRoles.includes(user.role)) &&
      (!n.linkModule || canAccessModule(user.role, n.linkModule))
  );
  const unreadCount = visibleNotifications.filter(
    (n) => !(n.readBy || []).includes(user.uid)
  ).length;

  const activeLabels = MODULE_LABELS[activeModule];
  const activeTitle = lang === 'en' ? activeLabels.en : activeLabels.id;
  const isMoreModuleActive = !accessibleMobileTabs.some((t) => t.id === activeModule);

  const initials = (user.displayName || user.email || 'DH')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="min-h-screen flex bg-[#F4F7FB] text-[#0B1B3A]">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0B1B3A]/60 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Collapsible Sidebar (Desktop) & Full Drawer (Mobile) */}
      <aside
        aria-label={tr('Navigasi utama', 'Primary navigation')}
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-dvh bg-[#0B1B3A] text-slate-100 flex flex-col justify-between transition-all duration-200 shrink-0 border-r border-[#1B5E99]/30',
          collapsed ? 'w-[76px]' : 'w-72 lg:w-64',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex flex-col flex-1 overflow-y-auto">
          {/* Corporate Logo Header */}
          <div className="px-3 py-3 border-b border-white/10">
            <div className="flex items-center justify-between gap-2">
              {collapsed ? (
                <div className="mx-auto bg-white rounded-lg p-1.5 border border-slate-200 shadow-xs">
                  <img
                    src="/assets/aistudio/image_adf18c6a.png"
                    alt="Logo DQH"
                    className="h-7 w-auto object-contain"
                  />
                </div>
              ) : (
                <div className="flex-1 bg-white rounded-lg px-3 py-2 border-b-2 border-[#D9AA32] shadow-xs flex items-center justify-center min-w-0">
                  <img
                    src={
                      settings.logoUrl && !settings.logoUrl.startsWith('/src/assets/')
                        ? settings.logoUrl
                        : '/assets/aistudio/image_21c89ab0.png'
                    }
                    alt="Logo PT Domestiq Hub Indonesia"
                    referrerPolicy="no-referrer"
                    className="h-8 w-auto max-w-full object-contain"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label={tr('Tutup menu', 'Close menu')}
                className="lg:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white shrink-0 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {!collapsed && (
              <div className="mt-2 px-1 text-[11px] tracking-wide text-slate-300 font-medium">
                General Supplier ERP
              </div>
            )}
          </div>

          <nav className="p-3 space-y-1">
            {accessibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              const label = lang === 'en' ? MODULE_LABELS[item.id].en : MODULE_LABELS[item.id].id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectModule(item.id);
                    setMobileMenuOpen(false);
                  }}
                  title={collapsed ? label : undefined}
                  className={cn(
                    'relative w-full flex items-center gap-3 px-3 min-h-[44px] lg:min-h-[40px] py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'bg-[#1B5E99] text-white shadow-xs'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#D9AA32]"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-[#FDF7E3]' : 'text-slate-400')} />
                  {!collapsed && <span className="truncate">{label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Mobile Drawer User, Language & Role Switch Section */}
          <div className="lg:hidden mt-auto p-3 border-t border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-300">{tr('Bahasa', 'Language')}</span>
              <div
                role="group"
                aria-label={tr('Pilih bahasa', 'Select language')}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 p-0.5"
              >
                {(['id', 'en'] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={cn(
                      'px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer',
                      lang === code ? 'bg-[#D9AA32] text-[#0B1B3A]' : 'text-slate-200 hover:text-white'
                    )}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {authMode === 'preview' && (
              <div className="space-y-1">
                <label htmlFor="mobile-role-switch" className="text-[11px] text-slate-300 block">
                  {tr('Simulasi Role Preview', 'Preview Role Simulation')}
                </label>
                <NativeSelect
                  id="mobile-role-switch"
                  value={user.role}
                  onChange={(e) => onSwitchPreviewRole(e.target.value as UserRole)}
                  className="bg-[#13284F] border-white/20 text-white text-sm"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r} className="text-[#0B1B3A]">
                      {r}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 p-2.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{user.displayName}</div>
                <div className="text-[11px] text-[#D9AA32] truncate">{user.role}</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onLogout}
                className="bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
                {tr('Keluar', 'Sign Out')}
              </Button>
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-white/10 hidden lg:block">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? tr('Perluas sidebar', 'Expand sidebar') : tr('Ciutkan sidebar', 'Collapse sidebar')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>{tr('Ciutkan Menu', 'Collapse Menu')}</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header (Compact 48px on Mobile, 64px on Desktop) */}
        <header className="sticky top-0 z-30 h-12 lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-3 sm:px-4 md:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={tr('Buka menu navigasi', 'Open navigation menu')}
              className="lg:hidden min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-[#0B1B3A] hover:bg-[#F4F7FB] cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline truncate max-w-[200px]">
                {settings.companyName}
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="text-sm sm:text-base font-bold text-[#0B1B3A] truncate">
                {activeTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {authMode === 'preview' && (
              <div className="hidden md:flex items-center gap-2">
                <label htmlFor="header-role-switch" className="text-xs text-slate-500 whitespace-nowrap">
                  {tr('Simulasi Role:', 'Role Simulation:')}
                </label>
                <NativeSelect
                  id="header-role-switch"
                  value={user.role}
                  onChange={(e) => onSwitchPreviewRole(e.target.value as UserRole)}
                  className="min-h-[36px] w-40 text-xs"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}

            {/* Bilingual Toggle (ID / EN) */}
            <div
              role="group"
              aria-label={tr('Pilih bahasa aplikasi', 'Select application language')}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 shrink-0"
            >
              {(['id', 'en'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={cn(
                    'min-h-[30px] lg:min-h-[28px] px-2 sm:px-2.5 text-[11px] font-bold rounded-md transition-colors cursor-pointer whitespace-nowrap',
                    lang === code
                      ? 'bg-[#0B1B3A] text-white'
                      : 'text-slate-600 hover:text-[#0B1B3A]'
                  )}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Notification Popover Button */}
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={tr(
                  `Notifikasi (${unreadCount} belum dibaca)`,
                  `Notifications (${unreadCount} unread)`
                )}
                onClick={() => setNotifOpen((prev) => !prev)}
                className="relative h-9 w-9"
              >
                <Bell className="h-4 w-4 text-[#0B1B3A]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#D9AA32] text-[#0B1B3A] text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </Button>

              {notifOpen && (
                <div className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-14 sm:top-auto sm:mt-2 sm:w-96 rounded-xl border border-slate-200 bg-white shadow-xl z-50">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#0B1B3A]">
                      {tr('Notifikasi Operasional', 'Operational Notifications')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs font-medium text-slate-500 hover:text-[#0B1B3A] px-2 py-1 cursor-pointer"
                    >
                      {tr('Tutup', 'Close')}
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {visibleNotifications.length === 0 ? (
                      <p className="p-4 text-xs text-slate-500">
                        {tr('Tidak ada notifikasi.', 'No notifications.')}
                      </p>
                    ) : (
                      visibleNotifications.map((n) => {
                        const isRead = (n.readBy || []).includes(user.uid);
                        return (
                          <div
                            key={n.id}
                            className={cn(
                              'p-3.5 space-y-1',
                              !isRead ? 'bg-[#EBF3FA]/50' : 'bg-white'
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-semibold text-[#0B1B3A]">
                                {n.title}
                              </span>
                              <span
                                className={cn(
                                  'text-[11px] font-medium shrink-0',
                                  n.severity === 'critical'
                                    ? 'text-red-700'
                                    : n.severity === 'warning'
                                    ? 'text-[#8F670D]'
                                    : 'text-[#1B5E99]'
                                )}
                              >
                                {n.severity === 'critical'
                                  ? tr('Kritis', 'Critical')
                                  : n.severity === 'warning'
                                  ? tr('Peringatan', 'Warning')
                                  : 'Info'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600">{n.message}</p>
                            <div className="flex items-center gap-3 pt-1">
                              {n.linkModule && canAccessModule(user.role, n.linkModule) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectModule(n.linkModule!);
                                    onMarkNotifRead(n.id);
                                    setNotifOpen(false);
                                  }}
                                  className="text-xs font-semibold text-[#1B5E99] hover:underline cursor-pointer"
                                >
                                  {tr('Buka Modul', 'Open Module')}
                                </button>
                              )}
                              {!isRead && (
                                <button
                                  type="button"
                                  onClick={() => onMarkNotifRead(n.id)}
                                  className="text-xs text-slate-500 hover:text-[#0B1B3A] cursor-pointer"
                                >
                                  {tr('Tandai Dibaca', 'Mark as Read')}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile + Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              {user.photoURL && !user.photoURL.startsWith('/src/assets/') && !avatarFailed ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="h-8 w-8 rounded-lg object-cover border border-slate-200 hidden sm:block"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-8 w-8 rounded-lg bg-[#0B1B3A] text-[#D9AA32] border border-[#1B5E99]/40 hidden sm:flex items-center justify-center text-xs font-bold"
                >
                  {initials || 'DH'}
                </div>
              )}
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-xs font-semibold text-[#0B1B3A] max-w-[140px] truncate">
                  {user.displayName}
                </div>
                <div className="text-[11px] text-[#1B5E99] font-semibold">{user.role}</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onLogout}
                aria-label={tr('Keluar dari sistem', 'Sign out of system')}
                className="min-h-[36px] lg:min-h-[34px] px-2.5 sm:px-3 whitespace-nowrap"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline">{tr('Keluar', 'Sign Out')}</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main
          className={cn(
            'flex-1 px-3 py-4 sm:p-5 lg:p-6 lg:pb-8 max-w-[1440px] w-full mx-auto',
            showMobileBottomNav ? 'pb-20' : 'pb-6'
          )}
        >
          {children}
        </main>
      </div>

      {/* Fixed Thumb-Zone Bottom Navigation Bar (Mobile < lg) */}
      {showMobileBottomNav && (
        <nav
          aria-label={tr('Navigasi cepat mobile', 'Mobile quick navigation')}
          className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-2px_10px_rgba(11,27,58,0.06)] pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-5 items-center h-14">
            {accessibleMobileTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeModule === tab.id;
              const shortLabel =
                lang === 'en' ? MODULE_LABELS[tab.id].shortEn : MODULE_LABELS[tab.id].shortId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectModule(tab.id)}
                  className={cn(
                    'flex flex-col items-center justify-center h-full px-1 transition-colors cursor-pointer relative',
                    isActive ? 'text-[#1B5E99]' : 'text-slate-500 hover:text-[#0B1B3A]'
                  )}
                >
                  {isActive && (
                    <span
                      className="absolute top-0 left-3 right-3 h-0.5 rounded-b bg-[#D9AA32]"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className={cn('h-5 w-5', isActive && 'text-[#1B5E99]')} />
                  <span className="text-[10px] font-semibold tracking-tight mt-0.5 truncate max-w-full">
                    {shortLabel}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className={cn(
                'flex flex-col items-center justify-center h-full px-1 transition-colors cursor-pointer relative',
                isMoreModuleActive ? 'text-[#1B5E99]' : 'text-slate-500 hover:text-[#0B1B3A]'
              )}
            >
              {isMoreModuleActive && (
                <span
                  className="absolute top-0 left-3 right-3 h-0.5 rounded-b bg-[#D9AA32]"
                  aria-hidden="true"
                />
              )}
              <LayoutGrid className="h-5 w-5" />
              <span className="text-[10px] font-semibold tracking-tight mt-0.5">
                {tr('Lainnya', 'More')}
              </span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
