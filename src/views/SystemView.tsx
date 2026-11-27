import { AlertTriangle, Check, CheckCheck, Copy, Download, Mail, MessageSquare, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BulkActionBar, SelectCheckbox } from '../components/ui/BulkActions';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  StatusLabel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '../components/ui/primitives';
import type { ErpController } from '../controllers/useErpController';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { useI18n } from '../lib/i18n';
import {
  buildReminderDrafts,
  DEFAULT_MANAGER_APPROVAL_LIMIT_IDR,
  formatCurrency,
  getEffectiveTaxRatePercent,
  isCompanyPkp,
} from '../models/erpLogic';
import { hasPermission } from '../models/rbac';
import { exportTableToCsv } from '../services/exportService';

function sanitizeDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
}

export function SystemView({ erp }: { erp: ErpController }) {
  const { state, currentUser } = erp;
  const { lang, tr } = useI18n();
  const canEditSettings = hasPermission(currentUser?.role, 'system:settings');
  const isDirektur = hasPermission(currentUser?.role, 'master:users');
  const [confirmDelete, setConfirmDelete] = useState<{
    title: string;
    description: string;
    detail: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resettingDb, setResettingDb] = useState(false);

  const [companyName, setCompanyName] = useState(state.settings.companyName || '');
  const [tagline, setTagline] = useState(state.settings.tagline || '');
  const [npwp, setNpwp] = useState(state.settings.npwp || '');
  const [address, setAddress] = useState(state.settings.address || '');
  const [phone, setPhone] = useState(state.settings.phone || '');
  const [email, setEmail] = useState(state.settings.email || '');
  const [bankName, setBankName] = useState(state.settings.bankName || '');
  const [bankAccountNumber, setBankAccountNumber] = useState(
    state.settings.bankAccountNumber || ''
  );
  const [bankAccountHolder, setBankAccountHolder] = useState(
    state.settings.bankAccountHolder || ''
  );
  const [managerLimit, setManagerLimit] = useState(
    String(state.settings.managerApprovalLimitIdr ?? DEFAULT_MANAGER_APPROVAL_LIMIT_IDR)
  );
  const [usdRate, setUsdRate] = useState(String(state.settings.defaultExchangeRateUsdIdr || 16250));
  const [taxRate, setTaxRate] = useState(String(state.settings.taxRatePercent ?? 11));
  const [isPkp, setIsPkp] = useState<boolean>(() => isCompanyPkp(state.settings));
  const [savingSettings, setSavingSettings] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setCompanyName(state.settings.companyName || '');
    setTagline(state.settings.tagline || '');
    setNpwp(state.settings.npwp || '');
    setAddress(state.settings.address || '');
    setPhone(state.settings.phone || '');
    setEmail(state.settings.email || '');
    setBankName(state.settings.bankName || '');
    setBankAccountNumber(state.settings.bankAccountNumber || '');
    setBankAccountHolder(state.settings.bankAccountHolder || '');
    setManagerLimit(
      String(state.settings.managerApprovalLimitIdr ?? DEFAULT_MANAGER_APPROVAL_LIMIT_IDR)
    );
    setUsdRate(String(state.settings.defaultExchangeRateUsdIdr || 16250));
    setTaxRate(String(state.settings.taxRatePercent ?? 11));
    setIsPkp(isCompanyPkp(state.settings));
  }, [state.settings]);

  const reminderDrafts = useMemo(
    () =>
      buildReminderDrafts({
        invoices: state.invoices,
        purchaseOrders: state.purchaseOrders,
        products: state.products,
        batches: state.inventoryBatches,
        customers: state.customers,
        suppliers: state.suppliers,
        lang,
        companyName: state.settings.companyName,
      }),
    [
      lang,
      state.customers,
      state.inventoryBatches,
      state.invoices,
      state.products,
      state.purchaseOrders,
      state.settings.companyName,
      state.suppliers,
    ]
  );

  const copyDraft = async (id: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedId(id);
      toast.success('Draft pesan berhasil disalin ke clipboard.');
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      toast.error('Tidak dapat menyalin teks otomatis di browser ini.');
    }
  };

  const auditIds = useMemo(() => state.auditLogs.map((l) => l.id), [state.auditLogs]);
  const auditSelection = useBulkSelection(auditIds);
  const notifIds = useMemo(() => state.notifications.map((n) => n.id), [state.notifications]);
  const notifSelection = useBulkSelection(notifIds);

  const exportSelectedAudits = () => {
    const picked = auditSelection.pickSelected(state.auditLogs);
    if (picked.length === 0) return;
    exportTableToCsv(
      `Audit_Log_Terpilih_${new Date().toISOString().slice(0, 10)}`,
      ['Waktu', 'Modul', 'Aksi', 'Pengguna', 'Role', 'Detail'],
      picked.map((l) => [
        (l.createdAt || '').slice(0, 19).replace('T', ' '),
        l.module,
        l.action,
        l.actorEmail || l.actorId,
        l.actorRole,
        l.details || '-',
      ])
    );
    toast.success(`${picked.length} baris Audit Log diekspor ke CSV.`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-[#0B1B3A]">
          {tr('Sistem, Audit Log & Pengaturan', 'System, Audit Log & Settings')}
        </h2>
        <p className="text-xs sm:text-sm text-slate-600">
          {tr(
            'Jejak audit aktivitas pengguna, notifikasi & draft follow-up, rekening resmi invoice, serta batas approval PO.',
            'User activity audit trail, notifications & follow-up drafts, official invoice bank info, and PO approval limits.'
          )}
        </p>
      </div>

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">
            {tr('Audit Log', 'Audit Log')} ({state.auditLogs.length})
          </TabsTrigger>
          <TabsTrigger value="notifications">
            {tr('Notifikasi & Follow-Up', 'Notifications & Follow-Up')} (
            {state.notifications.length + reminderDrafts.length})
          </TabsTrigger>
          <TabsTrigger value="company">
            {tr('Pengaturan Perusahaan', 'Company Settings')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit" className="space-y-3">
          {state.auditLogs.length > 0 && (
            <div className="flex items-center justify-between gap-2 md:hidden px-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <SelectCheckbox
                  checked={auditSelection.allVisibleSelected}
                  indeterminate={auditSelection.someVisibleSelected}
                  onChange={auditSelection.toggleAllVisible}
                  ariaLabel="Pilih semua log audit"
                />
                <span>Pilih Semua ({state.auditLogs.length})</span>
              </label>
            </div>
          )}

          <BulkActionBar
            selectedCount={auditSelection.selectedCount}
            itemLabel="log audit"
            onClear={auditSelection.clearSelection}
            actions={[
              {
                id: 'export-csv',
                label: 'Export Terpilih CSV',
                icon: <Download className="h-3.5 w-3.5" />,
                variant: 'outline',
                onClick: exportSelectedAudits,
              },
              ...(isDirektur
                ? [
                    {
                      id: 'delete-bulk',
                      label: 'Hapus Terpilih',
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      variant: 'destructive' as const,
                      requiresConfirm: true,
                      confirmLabel: `Konfirmasi Hapus (${auditSelection.selectedCount})`,
                      onClick: async () => {
                        await erp.bulkDeleteAuditLogs(Array.from(auditSelection.selectedIds));
                        auditSelection.clearSelection();
                      },
                    },
                  ]
                : []),
            ]}
          />

          {/* Mobile Audit Cards */}
          <div className="space-y-2.5 md:hidden max-h-[540px] overflow-y-auto pr-1">
            {state.auditLogs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada catatan audit sistem.
                </CardContent>
              </Card>
            ) : (
              state.auditLogs.map((log) => (
                <Card key={`m_aud_${log.id}`} className={auditSelection.isSelected(log.id) ? 'border-[#1B5E99] bg-[#F4F8FC]' : ''}>
                  <CardContent className="p-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <SelectCheckbox
                          checked={auditSelection.isSelected(log.id)}
                          onChange={() => auditSelection.toggleOne(log.id)}
                          ariaLabel={`Pilih log audit ${log.action}`}
                        />
                        <span className="font-semibold text-[#0B1B3A] truncate">{log.action}</span>
                      </div>
                      <StatusLabel status={log.module} tone="info" />
                    </div>
                    <div className="text-[11px] text-slate-600">{log.details || '-'}</div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                      <span className="truncate">
                        {log.actorEmail || log.actorId} ({log.actorRole})
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono tabular-nums">
                          {(log.createdAt || '').slice(0, 16).replace('T', ' ') || '-'}
                        </span>
                        {isDirektur && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Hapus audit ${log.action}`}
                            onClick={() =>
                              setConfirmDelete({
                                title: 'Hapus Entri Audit Log?',
                                description: 'Catatan jejak audit yang dipilih akan dihapus permanen.',
                                detail: `${log.module} — ${log.action}`,
                                onConfirm: async () => {
                                  await erp.deleteAuditLog(log.id);
                                },
                              })
                            }
                            className="text-red-600 hover:bg-red-50 h-7 px-2"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Desktop Audit Table */}
          <Card className="hidden md:block">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 border-b border-slate-200 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <th className="py-3 pl-4 pr-2 w-10">
                      <SelectCheckbox
                        checked={auditSelection.allVisibleSelected}
                        indeterminate={auditSelection.someVisibleSelected}
                        onChange={auditSelection.toggleAllVisible}
                        ariaLabel="Pilih semua log audit"
                      />
                    </th>
                    <th className="py-3 px-3 font-semibold">Waktu</th>
                    <th className="py-3 px-3 font-semibold">Modul</th>
                    <th className="py-3 px-3 font-semibold">Aksi</th>
                    <th className="py-3 px-3 font-semibold">Pengguna &amp; Role</th>
                    <th className="py-3 px-4 font-semibold">Detail</th>
                    {isDirektur && <th className="py-3 px-4 font-semibold text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={isDirektur ? 7 : 6} className="py-8 text-center text-slate-500">
                        Belum ada catatan audit sistem.
                      </td>
                    </tr>
                  ) : (
                    state.auditLogs.map((log) => (
                      <tr
                        key={log.id}
                        className={auditSelection.isSelected(log.id) ? 'bg-[#EFF5FB]/70' : 'hover:bg-slate-50/70'}
                      >
                        <td className="py-2.5 pl-4 pr-2">
                          <SelectCheckbox
                            checked={auditSelection.isSelected(log.id)}
                            onChange={() => auditSelection.toggleOne(log.id)}
                            ariaLabel={`Pilih log audit ${log.action}`}
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {(log.createdAt || '').slice(0, 19).replace('T', ' ') || '-'}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">{log.module}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{log.action}</td>
                        <td className="py-2.5 px-3">
                          <span className="text-slate-700">{log.actorEmail || log.actorId}</span>{' '}
                          <span className="text-[#1B5E99] font-semibold">({log.actorRole})</span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{log.details || '-'}</td>
                        {isDirektur && (
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus audit ${log.action}`}
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Entri Audit Log?',
                                  description: 'Catatan jejak audit yang dipilih akan dihapus permanen.',
                                  detail: `${log.module} — ${log.action}`,
                                  onConfirm: async () => {
                                    await erp.deleteAuditLog(log.id);
                                  },
                                })
                              }
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-5">
          {/* Smart Follow-Up Draft Composer */}
          <Card>
            <CardHeader>
              <CardTitle>
                Smart Follow-Up Draft Composer ({reminderDrafts.length})
              </CardTitle>
              <p className="text-xs text-slate-500">
                Draft pengingat otomatis untuk piutang jatuh tempo, approval PO, stok minimum, dan batch mendekati expired.
              </p>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-100 max-h-[440px] overflow-y-auto">
              {reminderDrafts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Tidak ada follow-up mendesak saat ini.
                </div>
              ) : (
                reminderDrafts.map((d) => (
                  <div key={d.id} className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusLabel
                          status={d.category}
                          tone={
                            d.severity === 'critical'
                              ? 'danger'
                              : d.severity === 'warning'
                              ? 'warning'
                              : 'info'
                          }
                        />
                        <span className="text-xs font-bold text-[#0B1B3A]">{d.subject}</span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        PIC: <strong className="text-slate-700">{d.recipientName}</strong>
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 bg-[#F4F7FB] border border-slate-200/80 rounded-lg p-3">
                      {d.message}
                    </pre>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void copyDraft(d.id, d.message)}
                      >
                        {copiedId === d.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedId === d.id ? 'Tersalin' : 'Salin Draft'}
                      </Button>
                      {d.whatsappUrl && (
                        <a
                          href={d.whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 min-h-[36px] text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Kirim WhatsApp
                        </a>
                      )}
                      {d.mailtoUrl && (
                        <a
                          href={d.mailtoUrl}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#BFD9EF] bg-[#EBF3FA] px-3 min-h-[36px] text-xs font-semibold text-[#154C7E] hover:bg-[#dcebf7] transition-colors"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Kirim Email
                        </a>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => erp.setActiveModule(d.targetModule)}
                      >
                        Buka Modul
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>Notifikasi Internal Sistem ({state.notifications.length})</CardTitle>
              {state.notifications.length > 0 && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
                  <SelectCheckbox
                    checked={notifSelection.allVisibleSelected}
                    indeterminate={notifSelection.someVisibleSelected}
                    onChange={notifSelection.toggleAllVisible}
                    ariaLabel="Pilih semua notifikasi"
                  />
                  <span>Pilih Semua</span>
                </label>
              )}
            </CardHeader>
            {notifSelection.selectedCount > 0 && (
              <div className="px-4 pb-3">
                <BulkActionBar
                  selectedCount={notifSelection.selectedCount}
                  itemLabel="notifikasi"
                  onClear={notifSelection.clearSelection}
                  actions={[
                    {
                      id: 'mark-read-bulk',
                      label: 'Tandai Dibaca',
                      icon: <CheckCheck className="h-3.5 w-3.5" />,
                      variant: 'outline',
                      onClick: async () => {
                        await erp.bulkMarkNotificationsRead(Array.from(notifSelection.selectedIds));
                        notifSelection.clearSelection();
                      },
                    },
                    ...(isDirektur
                      ? [
                          {
                            id: 'delete-notif-bulk',
                            label: 'Hapus Terpilih',
                            icon: <Trash2 className="h-3.5 w-3.5" />,
                            variant: 'destructive' as const,
                            requiresConfirm: true,
                            confirmLabel: `Konfirmasi Hapus (${notifSelection.selectedCount})`,
                            onClick: async () => {
                              await erp.bulkDeleteNotifications(Array.from(notifSelection.selectedIds));
                              notifSelection.clearSelection();
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            )}
            <CardContent className="p-0 divide-y divide-slate-100 max-h-[440px] overflow-y-auto">
              {state.notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Belum ada notifikasi internal tersimpan.
                </div>
              ) : (
                state.notifications.map((n) => {
                  const isRead = currentUser ? (n.readBy || []).includes(currentUser.uid) : false;
                  return (
                    <div
                      key={n.id}
                      className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        notifSelection.isSelected(n.id) ? 'bg-[#EFF5FB]/70' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <SelectCheckbox
                          checked={notifSelection.isSelected(n.id)}
                          onChange={() => notifSelection.toggleOne(n.id)}
                          ariaLabel={`Pilih notifikasi ${n.title}`}
                          className="mt-1"
                        />
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-[#0B1B3A]">{n.title}</span>
                            <StatusLabel
                              status={n.severity}
                              tone={
                                n.severity === 'critical'
                                  ? 'danger'
                                  : n.severity === 'warning'
                                  ? 'warning'
                                  : 'info'
                              }
                            />
                          </div>
                          <p className="text-xs text-slate-600">{n.message}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {!isRead && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void erp.markNotificationRead(n.id)}
                            className="flex-1 sm:flex-none"
                          >
                            Tandai Dibaca
                          </Button>
                        )}
                        {n.linkModule && (
                          <Button
                            type="button"
                            variant="accent"
                            size="sm"
                            onClick={() => erp.setActiveModule(n.linkModule!)}
                            className="flex-1 sm:flex-none"
                          >
                            Buka Modul
                          </Button>
                        )}
                        {isDirektur && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Hapus notifikasi ${n.title}`}
                            onClick={() =>
                              setConfirmDelete({
                                title: 'Hapus Notifikasi Sistem?',
                                description: 'Notifikasi ini akan dihapus permanen dari riwayat internal.',
                                detail: n.title,
                                onConfirm: async () => {
                                  await erp.deleteNotification(n.id);
                                },
                              })
                            }
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <CardTitle>
                {tr(
                  'Profil, Rekening Resmi & Parameter Tata Kelola',
                  'Company Profile, Official Bank & Governance Parameters'
                )}
              </CardTitle>
              <StatusLabel
                tone={isCompanyPkp(state.settings) ? 'success' : 'warning'}
                status={
                  isCompanyPkp(state.settings)
                    ? `PKP · PPN ${getEffectiveTaxRatePercent(state.settings)}% Aktif`
                    : 'Non-PKP · PPN 0% (Tanpa PPN Masukan/Keluaran)'
                }
              />
            </CardHeader>
            <CardContent className="space-y-6">
              <form
                className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (savingSettings) return;
                  const cleanName = companyName.trim();
                  const parsedUsd = Number(usdRate);
                  const parsedTax = Number(taxRate);
                  const parsedLimit = Number(managerLimit);
                  if (cleanName.length < 2) {
                    toast.error('Nama perusahaan minimal 2 karakter.');
                    return;
                  }
                  if (!Number.isFinite(parsedUsd) || parsedUsd <= 0) {
                    toast.error('Kurs 1 USD harus lebih besar dari 0.');
                    return;
                  }
                  if (!Number.isFinite(parsedTax) || parsedTax < 0 || parsedTax > 100) {
                    toast.error('PPN Default harus antara 0% sampai 100%.');
                    return;
                  }
                  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
                    toast.error('Batas approval PO Manager harus lebih besar dari 0.');
                    return;
                  }
                  setSavingSettings(true);
                  try {
                    await erp.updateCompanySettings({
                      companyName: cleanName,
                      tagline: tagline.trim(),
                      npwp: npwp.trim(),
                      address: address.trim(),
                      phone: phone.trim(),
                      email: email.trim(),
                      bankName: bankName.trim(),
                      bankAccountNumber: bankAccountNumber.trim(),
                      bankAccountHolder: bankAccountHolder.trim(),
                      managerApprovalLimitIdr: parsedLimit,
                      defaultExchangeRateUsdIdr: parsedUsd,
                      taxRatePercent: parsedTax,
                      isPkp,
                    });
                  } finally {
                    setSavingSettings(false);
                  }
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="set-name">Nama Perusahaan</Label>
                  <Input
                    id="set-name"
                    disabled={!canEditSettings}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-tag">Tagline Sistem</Label>
                  <Input
                    id="set-tag"
                    disabled={!canEditSettings}
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-npwp">NPWP Perusahaan</Label>
                  <Input
                    id="set-npwp"
                    disabled={!canEditSettings}
                    value={npwp}
                    onChange={(e) => setNpwp(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-phone">Telepon Kantor</Label>
                  <Input
                    id="set-phone"
                    type="tel"
                    disabled={!canEditSettings}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-email">Email Operasional</Label>
                  <Input
                    id="set-email"
                    type="email"
                    disabled={!canEditSettings}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-pkp">Status Pengusaha Kena Pajak (PKP)</Label>
                  <NativeSelect
                    id="set-pkp"
                    disabled={!canEditSettings}
                    value={isPkp ? 'pkp' : 'non-pkp'}
                    onChange={(e) => setIsPkp(e.target.value === 'pkp')}
                  >
                    <option value="non-pkp">Non-PKP (Belum PKP — PPN 0%, Tanpa PPN Masukan/Keluaran)</option>
                    <option value="pkp">PKP (Sudah PKP — Otomatis PPN)</option>
                  </NativeSelect>
                  <p className="text-[11px] text-slate-500">
                    {isPkp
                      ? 'Status PKP aktif: PO, GR/AP, SO, dan Retur otomatis menghitung & memposting jurnal PPN Masukan/Keluaran.'
                      : 'Status Non-PKP aktif: transaksi & jurnal otomatis PPN 0% (tanpa PPN Masukan/Keluaran). Ubah ke PKP kapan saja saat perusahaan sudah dikukuhkan PKP.'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="set-usd">Kurs 1 USD (IDR)</Label>
                    <Input
                      id="set-usd"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      disabled={!canEditSettings}
                      value={usdRate}
                      onChange={(e) => setUsdRate(sanitizeDigits(e.target.value))}
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="set-tax">PPN Default (%)</Label>
                    <Input
                      id="set-tax"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      disabled={!canEditSettings || !isPkp}
                      value={isPkp ? taxRate : '0'}
                      onChange={(e) => setTaxRate(sanitizeDigits(e.target.value))}
                      className="font-mono tabular-nums"
                    />
                  </div>
                </div>

                {/* Official Invoice Bank & Manager Approval Matrix */}
                <div className="space-y-1">
                  <Label htmlFor="set-bank-name">Nama Bank Rekening Resmi Invoice</Label>
                  <Input
                    id="set-bank-name"
                    disabled={!canEditSettings}
                    placeholder="Contoh: Bank Mandiri Korporat"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-bank-no">Nomor Rekening Resmi Invoice</Label>
                  <Input
                    id="set-bank-no"
                    disabled={!canEditSettings}
                    placeholder="Contoh: 122-00-0987654-3"
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-bank-holder">Pemegang Rekening (a/n)</Label>
                  <Input
                    id="set-bank-holder"
                    disabled={!canEditSettings}
                    placeholder="PT Domestiq Hub Indonesia"
                    value={bankAccountHolder}
                    onChange={(e) => setBankAccountHolder(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-mgr-limit">
                    Batas Approval PO Manager (IDR) — Di atas ini wajib Direktur
                  </Label>
                  <Input
                    id="set-mgr-limit"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    disabled={!canEditSettings}
                    value={managerLimit}
                    onChange={(e) => setManagerLimit(sanitizeDigits(e.target.value))}
                    className="font-mono tabular-nums"
                  />
                  <div className="text-[11px] text-slate-500 font-mono">
                    {formatCurrency(Number(managerLimit) || 0, 'IDR')}
                  </div>
                </div>

                <div className="md:col-span-2 space-y-1">
                  <Label htmlFor="set-addr">Alamat Kantor Pusat</Label>
                  <Textarea
                    id="set-addr"
                    disabled={!canEditSettings}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                {canEditSettings && (
                  <div className="md:col-span-2">
                    <Button
                      type="submit"
                      variant="accent"
                      disabled={savingSettings}
                      className="w-full sm:w-auto"
                    >
                      {savingSettings
                        ? tr('Menyimpan...', 'Saving...')
                        : tr('Simpan Pengaturan Perusahaan', 'Save Company Settings')}
                    </Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {isDirektur && (
            <Card className="mt-5 border-red-200 bg-red-50/40">
              <CardHeader>
                <CardTitle className="text-red-800 flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                  Zona Berbahaya — Kosongkan / Reset Database Total (Khusus Direktur)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-red-900">
                <p>
                  Tindakan ini akan menghapus permanen <strong>seluruh data</strong> di semua modul (Master Produk, Supplier, Buyer, Gudang, Kategori/UoM, Purchase Order, Vendor RFQ, Sales Order, Quotation, Retur, Inventory &amp; Batch, Invoice AP/AR, Buku Besar/CoA/Jurnal, Target Budget, Period Closing, Notifikasi, dan Audit Log). Akun Pengguna (RBAC) dan Profil Perusahaan tetap dipertahankan agar Anda tidak terkunci, serta database tidak akan diisi ulang data contoh secara otomatis.
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    setResetPhrase('');
                    setResetModalOpen(true);
                  }}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Kosongkan Database Total Sekarang
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* CONFIRM DELETE SINGLE RECORD DIALOG */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDelete?.title}</DialogTitle>
            <DialogDescription>{confirmDelete?.description}</DialogDescription>
          </DialogHeader>
          {confirmDelete && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-medium text-slate-800">
              {confirmDelete.detail}
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={deletingItem}
              onClick={() => setConfirmDelete(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={deletingItem}
              onClick={async () => {
                if (!confirmDelete) return;
                setDeletingItem(true);
                try {
                  await confirmDelete.onConfirm();
                  setConfirmDelete(null);
                } finally {
                  setDeletingItem(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deletingItem ? 'Menghapus...' : 'Ya, Hapus Permanen'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CONFIRM TOTAL DATABASE RESET DIALOG */}
      <Dialog open={resetModalOpen} onOpenChange={setResetModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Konfirmasi Kosongkan Database Total
            </DialogTitle>
            <DialogDescription>
              Seluruh data operasional, master partner/produk, inventory, jurnal akuntansi, dan histori akan dihapus permanen. Ketik kata <strong>KOSONGKAN</strong> untuk melanjutkan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              aria-label="Ketik KOSONGKAN"
              placeholder="Ketik KOSONGKAN"
              value={resetPhrase}
              onChange={(e) => setResetPhrase(e.target.value)}
              className="font-mono uppercase"
            />
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={resettingDb}
                onClick={() => setResetModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="button"
                disabled={resettingDb || resetPhrase.trim().toUpperCase() !== 'KOSONGKAN'}
                onClick={async () => {
                  setResettingDb(true);
                  try {
                    const ok = await erp.resetTotalDatabase();
                    if (ok) {
                      setResetModalOpen(false);
                      setResetPhrase('');
                    }
                  } finally {
                    setResettingDb(false);
                  }
                }}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {resettingDb ? 'Mengosongkan Database...' : 'Ya, Kosongkan Total'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
