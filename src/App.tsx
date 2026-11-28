import { Toaster } from 'sonner';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView } from './components/LoginView';
import { PrintDocumentProvider } from './components/PrintableDocumentModal';
import { useErpController } from './controllers/useErpController';
import { LanguageProvider, useI18n } from './lib/i18n';
import { canAccessModule } from './models/rbac';
import { AccountingView } from './views/AccountingView';
import { DashboardView } from './views/DashboardView';
import { InventoryView } from './views/InventoryView';
import { MasterDataView } from './views/MasterDataView';
import { PurchaseOrderView } from './views/PurchaseOrderView';
import { ReportsView } from './views/ReportsView';
import { SalesOrderView } from './views/SalesOrderView';
import { SystemView } from './views/SystemView';

function DomestiqHubApp() {
  const erp = useErpController();
  const { tr } = useI18n();

  if (erp.authMode === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B1B3A] text-white px-4">
        <div className="text-center space-y-4">
          <div className="mx-auto w-fit rounded-lg bg-white px-4 py-2.5 shadow-md border-b-2 border-[#D9AA32]">
            <img
              src="/assets/aistudio/image_21c89ab0.png"
              alt="PT Domestiq Hub Indonesia"
              className="h-9 w-auto object-contain"
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold tracking-tight text-white">
              Domestiq Hub System
            </div>
            <div className="text-xs text-slate-300">
              {tr(
                'Memuat sesi otentikasi & konfigurasi korporat...',
                'Loading authentication session & corporate workspace...'
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (erp.authMode === 'unauthenticated' || !erp.currentUser) {
    return (
      <LoginView
        onEmailLogin={erp.loginWithEmail}
        onEmailRegister={erp.registerWithEmail}
        onGoogleLogin={erp.loginWithGoogle}
        busy={erp.authBusy}
        error={erp.authError}
        infoMessage={erp.authInfo}
      />
    );
  }

  const effectiveModule = canAccessModule(erp.currentUser.role, erp.activeModule)
    ? erp.activeModule
    : 'dashboard';

  return (
    <AppShell
      user={erp.currentUser}
      authMode={erp.authMode}
      settings={erp.state.settings}
      activeModule={effectiveModule}
      onSelectModule={erp.setActiveModule}
      notifications={erp.state.notifications}
      onMarkNotifRead={erp.markNotificationRead}
      onSwitchPreviewRole={erp.switchPreviewRole}
      onLogout={erp.logout}
    >
      {effectiveModule === 'dashboard' && <DashboardView erp={erp} />}
      {effectiveModule === 'master' && <MasterDataView erp={erp} />}
      {effectiveModule === 'purchasing' && <PurchaseOrderView erp={erp} />}
      {effectiveModule === 'inventory' && <InventoryView erp={erp} />}
      {effectiveModule === 'sales' && <SalesOrderView erp={erp} />}
      {effectiveModule === 'accounting' && <AccountingView erp={erp} />}
      {effectiveModule === 'reports' && <ReportsView erp={erp} />}
      {effectiveModule === 'system' && <SystemView erp={erp} />}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <PrintDocumentProvider>
          <DomestiqHubApp />
          <Toaster position="top-right" richColors />
        </PrintDocumentProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
