import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  Database,
  Landmark,
  Mail,
  MessageSquare,
  MonitorPlay,
  Plus,
  Printer,
  ShoppingCart,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePrintDocument } from '../components/PrintableDocumentModal';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusLabel,
} from '../components/ui/primitives';
import type { ErpController } from '../controllers/useErpController';
import { formatAgingBucketLabel, useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';
import {
  buildExecutiveContributions,
  buildReminderDrafts,
  buildSixMonthChartSeries,
  calculateTotalStockValueIdr,
  computeBalanceSheet,
  computeBudgetVsActual,
  computeIncomeStatement,
  computeMonthlyPerformance,
  computeTrialBalance,
  convertToIdr,
  formatCompactIdr,
  formatCurrency,
  formatMonthKeyLabel,
  getTotalProductStock,
  isCashBankAccount,
  isLowStockProduct,
  isPoOverdue,
  resolvePeriodDateRange,
  summarizeAgingReport,
  type AgingBucket,
  type ExecutivePeriodFilter,
} from '../models/erpLogic';
import { buildTableReportPrintDoc } from '../models/printDocumentModel';
import { canAccessModule, hasPermission } from '../models/rbac';
import type { AppModule } from '../models/types';
import { exportExecutiveBoardPdf } from '../services/exportService';

const AGING_BUCKETS: AgingBucket[] = [
  'Belum Jatuh Tempo',
  '1-30 Hari',
  '31-60 Hari',
  '61-90 Hari',
  '> 90 Hari',
];

export function DashboardView({ erp }: { erp: ErpController }) {
  const { state, currentUser, setActiveModule } = erp;
  const { lang, tr } = useI18n();
  const { openPrintPreview } = usePrintDocument();
  const rate = state.settings.defaultExchangeRateUsdIdr || 16250;

  const [period, setPeriod] = useState<ExecutivePeriodFilter>('all');
  const [meetingMode, setMeetingMode] = useState(false);
  const [chartMode, setChartMode] = useState<'pnl' | 'trade'>('pnl');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>('');
  const [financeTab, setFinanceTab] = useState<'balance' | 'aging'>('balance');
  const [agingLedger, setAgingLedger] = useState<'AR' | 'AP'>('AR');
  const [rankingTab, setRankingTab] = useState<'customers' | 'suppliers' | 'categories'>('customers');
  const [opsTab, setOpsTab] = useState<'alerts' | 'pipeline'>('alerts');
  const [copiedDraftId, setCopiedDraftId] = useState<string | null>(null);

  const isDashboardOnlyRole =
    currentUser?.role === 'Angel Investor' || currentUser?.role === 'Viewer';
  const canOpenModule = (mod: AppModule) => canAccessModule(currentUser?.role, mod);
  const canOpenAccounting = canOpenModule('accounting');
  const canOpenReports = canOpenModule('reports');
  const canOpenInventory = canOpenModule('inventory');
  const canOpenPurchasing = canOpenModule('purchasing');
  const canOpenSales = canOpenModule('sales');
  const showQuickActionsBar =
    !meetingMode &&
    !isDashboardOnlyRole &&
    (canOpenAccounting ||
      canOpenReports ||
      hasPermission(currentUser?.role, 'po:create') ||
      hasPermission(currentUser?.role, 'so:create'));

  const dateRange = useMemo(() => resolvePeriodDateRange(period), [period]);

  const periodLabel = useMemo(() => {
    switch (period) {
      case 'month':
        return tr('Bulan Berjalan', 'Current Month');
      case 'quarter':
        return tr('3 Bulan Terakhir', 'Last 3 Months');
      case '6m':
        return tr('6 Bulan Terakhir', 'Last 6 Months');
      default:
        return tr('Semua Periode (YTD / Akumulasi)', 'All Periods (Cumulative)');
    }
  }, [period, tr]);

  const incomeStatement = useMemo(
    () =>
      computeIncomeStatement(
        state.chartOfAccounts,
        state.journalEntries,
        dateRange.startDate,
        dateRange.endDate
      ),
    [state.chartOfAccounts, state.journalEntries, dateRange.startDate, dateRange.endDate]
  );

  const balanceSheet = useMemo(
    () => computeBalanceSheet(state.chartOfAccounts, state.journalEntries, dateRange.endDate),
    [state.chartOfAccounts, state.journalEntries, dateRange.endDate]
  );

  const trialBalance = useMemo(
    () =>
      computeTrialBalance(
        state.chartOfAccounts,
        state.journalEntries,
        undefined,
        dateRange.endDate
      ),
    [state.chartOfAccounts, state.journalEntries, dateRange.endDate]
  );

  const monthlyPerf = useMemo(
    () =>
      computeMonthlyPerformance(
        state.chartOfAccounts,
        state.journalEntries,
        state.purchaseOrders,
        state.salesOrders,
        rate
      ),
    [state.chartOfAccounts, state.journalEntries, state.purchaseOrders, state.salesOrders, rate]
  );

  const sixMonthSeries = useMemo(
    () => buildSixMonthChartSeries(state.purchaseOrders, state.salesOrders, rate, new Date(), lang),
    [state.purchaseOrders, state.salesOrders, rate, lang]
  );

  const cashAndBankIdr = useMemo(
    () =>
      trialBalance.rows
        .filter((r) => isCashBankAccount(r.account))
        .reduce((s, r) => s + r.closingBalanceIdr, 0),
    [trialBalance.rows]
  );

  const totalStockValueIdr = useMemo(
    () => calculateTotalStockValueIdr(state.products, rate),
    [state.products, rate]
  );

  const totalApIdr = useMemo(
    () =>
      state.invoices
        .filter((i) => i.ledgerType === 'AP' && i.balanceDue > 0)
        .reduce((s, i) => s + convertToIdr(i.balanceDue, i.currency, i.exchangeRate || rate), 0),
    [state.invoices, rate]
  );

  const totalArIdr = useMemo(
    () =>
      state.invoices
        .filter((i) => i.ledgerType === 'AR' && i.balanceDue > 0)
        .reduce((s, i) => s + convertToIdr(i.balanceDue, i.currency, i.exchangeRate || rate), 0),
    [state.invoices, rate]
  );

  const netWorkingCapitalIdr = cashAndBankIdr + totalArIdr + totalStockValueIdr - totalApIdr;

  const grossMarginPct =
    incomeStatement.totalRevenueIdr > 0
      ? (incomeStatement.grossProfitIdr / incomeStatement.totalRevenueIdr) * 100
      : 0;
  const netMarginPct =
    incomeStatement.totalRevenueIdr > 0
      ? (incomeStatement.netIncomeIdr / incomeStatement.totalRevenueIdr) * 100
      : 0;

  const contributions = useMemo(
    () =>
      buildExecutiveContributions({
        purchaseOrders: state.purchaseOrders,
        salesOrders: state.salesOrders,
        products: state.products,
        usdToIdrRate: rate,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      }),
    [state.purchaseOrders, state.salesOrders, state.products, rate, dateRange]
  );

  const arAging = useMemo(
    () => summarizeAgingReport(state.invoices, 'AR', rate),
    [state.invoices, rate]
  );
  const apAging = useMemo(
    () => summarizeAgingReport(state.invoices, 'AP', rate),
    [state.invoices, rate]
  );

  const outstandingPos = useMemo(
    () =>
      state.purchaseOrders.filter(
        (p) => !['Closed', 'Cancelled', 'Fully Received'].includes(p.status)
      ),
    [state.purchaseOrders]
  );
  const outstandingPoValueIdr = useMemo(
    () =>
      outstandingPos.reduce(
        (sum, po) => sum + convertToIdr(po.totalAmount, po.currency, po.exchangeRate || rate),
        0
      ),
    [outstandingPos, rate]
  );

  const outstandingSos = useMemo(
    () => state.salesOrders.filter((s) => s.status !== 'Closed'),
    [state.salesOrders]
  );
  const outstandingSoValueIdr = useMemo(
    () =>
      outstandingSos.reduce(
        (sum, so) => sum + convertToIdr(so.totalAmount, so.currency, rate),
        0
      ),
    [outstandingSos, rate]
  );

  const lowStockProducts = useMemo(
    () => state.products.filter(isLowStockProduct),
    [state.products]
  );
  const overduePos = useMemo(
    () => state.purchaseOrders.filter((p) => isPoOverdue(p)),
    [state.purchaseOrders]
  );
  const overdueInvoices = useMemo(
    () => state.invoices.filter((i) => i.status === 'OVERDUE'),
    [state.invoices]
  );
  const totalAlertCount = lowStockProducts.length + overduePos.length + overdueInvoices.length;

  const budgetRows = useMemo(
    () => computeBudgetVsActual(state.budgets, monthlyPerf, lang),
    [state.budgets, monthlyPerf, lang]
  );

  const reminderDrafts = useMemo(
    () =>
      isDashboardOnlyRole
        ? []
        : buildReminderDrafts({
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
      isDashboardOnlyRole,
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

  const handleCopyDraft = async (id: string, msg: string) => {
    try {
      await navigator.clipboard?.writeText(msg);
      setCopiedDraftId(id);
      toast.success(tr('Draft pesan disalin ke clipboard.', 'Draft copied to clipboard.'));
      setTimeout(() => setCopiedDraftId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      toast.error(tr('Gagal menyalin teks.', 'Failed to copy text.'));
    }
  };

  const chartMonths = useMemo(() => {
    const base = monthlyPerf.months.slice(-6);
    return base.map((m) => ({
      ...m,
      displayLabel: formatMonthKeyLabel(m.monthKey, lang),
    }));
  }, [monthlyPerf.months, lang]);

  useEffect(() => {
    if (chartMonths.length > 0 && !chartMonths.some((m) => m.monthKey === selectedMonthKey)) {
      setSelectedMonthKey(chartMonths[chartMonths.length - 1].monthKey);
    }
  }, [chartMonths, selectedMonthKey]);

  const activeMonthDetail = useMemo(
    () => chartMonths.find((m) => m.monthKey === selectedMonthKey) || chartMonths[chartMonths.length - 1],
    [chartMonths, selectedMonthKey]
  );

  const maxPnlVal = Math.max(
    1,
    ...chartMonths.flatMap((m) => [m.revenueIdr, Math.max(0, m.grossProfitIdr), Math.max(0, m.netIncomeIdr)])
  );
  const maxTradeVal = Math.max(
    1,
    ...sixMonthSeries.flatMap((d) => [d.pembelianIdr, d.penjualanIdr])
  );

  const activeRankingList =
    rankingTab === 'customers'
      ? contributions.topCustomers
      : rankingTab === 'suppliers'
      ? contributions.topSuppliers
      : contributions.stockByCategory;

  const activeAgingSummary = agingLedger === 'AR' ? arAging : apAging;
  const activeAgingTotal = Object.values(activeAgingSummary).reduce((s, v) => s + v, 0);

  const poPipelineStats = useMemo(() => {
    const groups = [
      {
        label: tr('Draft & Pengajuan', 'Draft & Submitted'),
        count: state.purchaseOrders.filter((p) => ['Draft', 'Submitted'].includes(p.status)).length,
        tone: 'neutral' as const,
      },
      {
        label: tr('Disetujui & Dipesan', 'Approved & Ordered'),
        count: state.purchaseOrders.filter((p) => ['Approved by Manager', 'Ordered'].includes(p.status)).length,
        tone: 'info' as const,
      },
      {
        label: tr('Diterima Sebagian', 'Partially Received'),
        count: state.purchaseOrders.filter((p) => p.status === 'Partially Received').length,
        tone: 'warning' as const,
      },
      {
        label: tr('Selesai / Ditutup', 'Received / Closed'),
        count: state.purchaseOrders.filter((p) => ['Fully Received', 'Closed'].includes(p.status)).length,
        tone: 'success' as const,
      },
    ];
    return groups;
  }, [state.purchaseOrders, tr]);

  const soPipelineStats = useMemo(() => {
    const groups = [
      {
        label: tr('Draft & Konfirmasi', 'Draft & Confirmed'),
        count: state.salesOrders.filter((s) => ['Draft', 'Confirmed'].includes(s.status)).length,
        tone: 'info' as const,
      },
      {
        label: tr('Pengiriman Parsial', 'Partially Delivered'),
        count: state.salesOrders.filter((s) => s.status === 'Partially Delivered').length,
        tone: 'warning' as const,
      },
      {
        label: tr('Terkirim & Penagihan', 'Delivered & Invoiced'),
        count: state.salesOrders.filter((s) => ['Fully Delivered', 'Invoiced'].includes(s.status)).length,
        tone: 'info' as const,
      },
      {
        label: tr('Lunas / Selesai', 'Closed'),
        count: state.salesOrders.filter((s) => s.status === 'Closed').length,
        tone: 'success' as const,
      },
    ];
    return groups;
  }, [state.salesOrders, tr]);

  const handleOpenBriefingPreview = () => {
    const briefingParams = {
      lang,
      company: state.settings,
      periodLabel,
      revenueIdr: incomeStatement.totalRevenueIdr,
      grossProfitIdr: incomeStatement.grossProfitIdr,
      grossMarginPct,
      netIncomeIdr: incomeStatement.netIncomeIdr,
      netMarginPct,
      totalAssetsIdr: balanceSheet.totalAssetsIdr,
      totalLiabilitiesIdr: balanceSheet.totalLiabilitiesIdr,
      totalEquityIdr: balanceSheet.totalEquityIdr,
      cashAndBankIdr,
      stockValueIdr: totalStockValueIdr,
      totalArIdr,
      totalApIdr,
      netWorkingCapitalIdr,
      monthlyRows: monthlyPerf.months.map((m) => ({
        ...m,
        monthLabel: formatMonthKeyLabel(m.monthKey, lang),
      })),
      topCustomers: contributions.topCustomers,
    };

    const rows: string[][] = [
      [tr('Pendapatan Usaha (Revenue)', 'Operating Revenue'), formatCurrency(incomeStatement.totalRevenueIdr), `${grossMarginPct.toFixed(1)}% Gross Margin`],
      [tr('Laba Kotor (Gross Profit)', 'Gross Profit'), formatCurrency(incomeStatement.grossProfitIdr), tr('HPP / COGS: ', 'COGS: ') + formatCurrency(incomeStatement.totalCogsIdr)],
      [tr('Laba Bersih (Net Income)', 'Net Income'), formatCurrency(incomeStatement.netIncomeIdr), `${netMarginPct.toFixed(1)}% Net Margin`],
      [tr('Total Aset / Ekuitas', 'Total Assets / Equity'), formatCurrency(balanceSheet.totalAssetsIdr), `${tr('Ekuitas', 'Equity')}: ${formatCurrency(balanceSheet.totalEquityIdr)}`],
      [tr('Kas & Bank / Nilai Stok', 'Cash & Bank / Inventory'), formatCurrency(cashAndBankIdr), `${tr('Stok', 'Stock')}: ${formatCurrency(totalStockValueIdr)}`],
      [tr('Piutang (AR) / Hutang (AP)', 'AR / AP Position'), formatCurrency(totalArIdr), `AP: ${formatCurrency(totalApIdr)}`],
      [tr('Modal Kerja Bersih', 'Net Working Capital'), formatCurrency(netWorkingCapitalIdr), tr('Likuiditas Jangka Pendek', 'Short-Term Liquidity')],
      ...contributions.topCustomers.slice(0, 5).map((c, idx) => [
        `${tr('Top Customer', 'Top Customer')} #${idx + 1}: ${c.name}`,
        formatCurrency(c.amountIdr),
        `${c.count} SO (${c.sharePercent.toFixed(1)}%)`,
      ]),
    ];

    openPrintPreview(
      buildTableReportPrintDoc({
        documentTitle: tr('BRIEFING EKSEKUTIF & PEMEGANG SAHAM', 'EXECUTIVE & SHAREHOLDER BRIEFING'),
        documentNumber: `EXEC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
        filenameBase: 'Executive_Board_Briefing',
        subtitle: periodLabel,
        company: state.settings,
        orientation: 'portrait',
        leftMeta: [
          { label: tr('Periode Analisis', 'Analysis Period'), value: periodLabel },
          { label: tr('Status Neraca', 'Balance Sheet'), value: balanceSheet.isBalanced ? tr('Seimbang (Terverifikasi)', 'Balanced') : tr('Perlu Review', 'Review Needed') },
          { label: tr('Kurs Referensi', 'FX Reference'), value: `1 USD = ${formatCurrency(rate)}` },
        ],
        rightMeta: [
          { label: tr('Perusahaan', 'Company'), value: state.settings.companyName || 'PT Domestiq Hub Indonesia' },
          { label: tr('Disusun Untuk', 'Prepared For'), value: currentUser?.displayName || 'Board & Shareholders' },
          { label: 'Role', value: currentUser?.role || 'Direktur' },
        ],
        columns: [
          { header: tr('Indikator / Kontributor Utama', 'Key Metric / Top Contributor'), align: 'left', bold: true },
          { header: tr('Nilai (IDR)', 'Amount (IDR)'), align: 'right', mono: true },
          { header: tr('Keterangan / Rasio', 'Notes / Ratio'), align: 'left' },
        ],
        rows,
        notesTitle: tr('Ringkasan Narasi Eksekutif', 'Executive Narrative'),
        notesText: tr(
          `Pendapatan usaha periode ${periodLabel.toLowerCase()} tercatat ${formatCurrency(incomeStatement.totalRevenueIdr)} dengan margin kotor ${grossMarginPct.toFixed(1)}% dan laba bersih ${formatCurrency(incomeStatement.netIncomeIdr)}. Posisi kas & bank ${formatCurrency(cashAndBankIdr)} dan modal kerja bersih ${formatCurrency(netWorkingCapitalIdr)}.`,
          `For ${periodLabel.toLowerCase()}, operating revenue reached ${formatCurrency(incomeStatement.totalRevenueIdr)} with ${grossMarginPct.toFixed(1)}% gross margin and ${formatCurrency(incomeStatement.netIncomeIdr)} net income.`
        ),
        signerName: currentUser?.displayName || state.settings.companyName,
      }),
      () => exportExecutiveBoardPdf(briefingParams)
    );
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Executive Header & Boardroom Controls */}
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3.5">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-bold text-[#0B1B3A] tracking-tight">
              {tr('Ringkasan Eksekutif & Pemegang Saham', 'Executive & Shareholder Briefing')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-[#0B1B3A]">{state.settings.companyName}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {tr('Kurs Referensi', 'FX Reference')}: 1 USD = {formatCurrency(rate)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{periodLabel}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Period Filter Segmented Control */}
            <div
              role="group"
              aria-label={tr('Filter periode laporan', 'Report period filter')}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 overflow-x-auto max-w-full"
            >
              {(
                [
                  { id: 'month', idLabel: 'Bulan Ini', enLabel: 'This Month' },
                  { id: 'quarter', idLabel: '3 Bulan', enLabel: 'Quarter' },
                  { id: '6m', idLabel: '6 Bulan', enLabel: '6 Months' },
                  { id: 'all', idLabel: 'Semua', enLabel: 'All Time' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPeriod(item.id)}
                  className={cn(
                    'min-h-[34px] px-2.5 sm:px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    period === item.id
                      ? 'bg-[#0B1B3A] text-white'
                      : 'text-slate-600 hover:text-[#0B1B3A]'
                  )}
                >
                  {lang === 'en' ? item.enLabel : item.idLabel}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant={meetingMode ? 'accent' : 'outline'}
              size="sm"
              onClick={() => setMeetingMode((prev) => !prev)}
              className="whitespace-nowrap shrink-0"
            >
              <MonitorPlay className="h-4 w-4" />
              {meetingMode
                ? tr('Keluar Mode Rapat', 'Exit Meeting Mode')
                : tr('Mode Presentasi', 'Meeting Mode')}
            </Button>

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleOpenBriefingPreview}
              className="whitespace-nowrap shrink-0"
            >
              <Printer className="h-4 w-4" />
              {tr('Cetak Preview', 'Print Preview')}
            </Button>
          </div>
        </div>

        {/* Operational Quick Shortcuts (hidden when in focused Meeting Mode or Dashboard-only role) */}
        {showQuickActionsBar && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/80">
            {(canOpenAccounting || canOpenReports) && (
              <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{tr('Akses Cepat Operasional:', 'Quick Operational Actions:')}</span>
                {canOpenAccounting && (
                  <button
                    type="button"
                    onClick={() => setActiveModule('accounting')}
                    className="font-semibold text-[#1B5E99] hover:underline cursor-pointer whitespace-nowrap"
                  >
                    {tr('Buku Besar & Jurnal', 'General Ledger')}
                  </button>
                )}
                {canOpenAccounting && canOpenReports && <span aria-hidden="true">·</span>}
                {canOpenReports && (
                  <button
                    type="button"
                    onClick={() => setActiveModule('reports')}
                    className="font-semibold text-[#1B5E99] hover:underline cursor-pointer whitespace-nowrap"
                  >
                    {tr('Pusat Laporan', 'Reports Hub')}
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
              {hasPermission(currentUser?.role, 'po:create') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveModule('purchasing')}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  {tr('Buat PO', 'Create PO')}
                </Button>
              )}
              {hasPermission(currentUser?.role, 'so:create') && (
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={() => setActiveModule('sales')}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  {tr('Buat SO', 'Create SO')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {erp.authMode === 'supabase' &&
        currentUser?.role === 'Direktur' &&
        state.chartOfAccounts.length === 0 &&
        state.warehouses.length === 0 &&
        state.products.length === 0 && (
          <Card className="border-sky-200 bg-sky-50/70">
            <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-[#0B1B3A] flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#1B5E99]" />
                  {tr(
                    'Database Supabase Perusahaan Masih Kosong',
                    'Company Supabase Database Is Empty'
                  )}
                </div>
                <p className="text-xs text-slate-600">
                  {tr(
                    'Isi otomatis 16 Daftar Akun (CoA Standar), gudang, satuan, kategori, master partner/produk, serta data awal ERP langsung ke PostgreSQL Supabase Anda.',
                    'Automatically populate 16 standard Chart of Accounts, warehouses, UoMs, categories, master partners/products, and sample ERP data into your Supabase PostgreSQL.'
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="accent"
                disabled={erp.seedingDatabase}
                onClick={() => void erp.seedInitialData()}
                className="shrink-0"
              >
                <Database className="h-4 w-4" />
                {erp.seedingDatabase
                  ? tr('Mengisi Data...', 'Seeding Database...')
                  : tr('Muat Data Awal & CoA ERP', 'Load Initial ERP Data & CoA')}
              </Button>
            </CardContent>
          </Card>
        )}

      {/* Boardroom Executive Briefing Strip (Expanded in Meeting Mode, Compact Always) */}
      <Card className={cn(meetingMode ? 'bg-[#0B1B3A] text-white border-[#1B5E99]' : 'bg-white')}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className={meetingMode ? 'text-[#D9AA32]' : 'text-[#1B5E99]'}>
                  {tr('Sorotan Pimpinan & Rapat Pemegang Saham', 'Board & Shareholder Highlights')}
                </span>
                <span aria-hidden="true" className={meetingMode ? 'text-slate-500' : 'text-slate-300'}>
                  ·
                </span>
                <span className={meetingMode ? 'text-slate-300' : 'text-slate-500'}>
                  {balanceSheet.isBalanced
                    ? tr('Neraca Seimbang (Terverifikasi)', 'Balance Sheet Reconciled')
                    : tr('Perlu Review Selisih Neraca', 'Balance Sheet Review Needed')}
                </span>
              </div>
              <p className={cn('text-xs sm:text-sm leading-relaxed', meetingMode ? 'text-slate-200' : 'text-slate-700')}>
                {tr(
                  `Pada periode ${periodLabel.toLowerCase()}, pendapatan usaha tercatat ${formatCurrency(incomeStatement.totalRevenueIdr)} dengan margin kotor ${grossMarginPct.toFixed(1)}% dan laba bersih ${formatCurrency(incomeStatement.netIncomeIdr)}. Posisi kas & bank sebesar ${formatCurrency(cashAndBankIdr)} serta modal kerja bersih ${formatCurrency(netWorkingCapitalIdr)}.`,
                  `For ${periodLabel.toLowerCase()}, operating revenue reached ${formatCurrency(incomeStatement.totalRevenueIdr)} at a ${grossMarginPct.toFixed(1)}% gross margin and ${formatCurrency(incomeStatement.netIncomeIdr)} net income. Cash & bank reserves stand at ${formatCurrency(cashAndBankIdr)} with ${formatCurrency(netWorkingCapitalIdr)} in net working capital.`
                )}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 shrink-0 border-t lg:border-t-0 lg:border-l pt-3 lg:pt-0 lg:pl-5 border-slate-200/30">
              <div>
                <div className={cn('text-[11px]', meetingMode ? 'text-slate-300' : 'text-slate-500')}>
                  {tr('Margin Kotor', 'Gross Margin')}
                </div>
                <div className={cn('text-base sm:text-lg font-bold font-mono tabular-nums', meetingMode ? 'text-[#D9AA32]' : 'text-[#0B1B3A]')}>
                  {grossMarginPct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className={cn('text-[11px]', meetingMode ? 'text-slate-300' : 'text-slate-500')}>
                  {tr('Margin Bersih', 'Net Margin')}
                </div>
                <div className={cn('text-base sm:text-lg font-bold font-mono tabular-nums', meetingMode ? 'text-white' : 'text-[#0B1B3A]')}>
                  {netMarginPct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className={cn('text-[11px]', meetingMode ? 'text-slate-300' : 'text-slate-500')}>
                  {tr('Rasio AR / AP', 'AR / AP Ratio')}
                </div>
                <div className={cn('text-base sm:text-lg font-bold font-mono tabular-nums', meetingMode ? 'text-emerald-300' : 'text-emerald-700')}>
                  {totalApIdr > 0 ? `${(totalArIdr / totalApIdr).toFixed(2)}x` : tr('Bebas Hutang', 'Debt-Free')}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4 Primary Executive Financial KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div
          role={canOpenAccounting ? 'button' : undefined}
          tabIndex={canOpenAccounting ? 0 : undefined}
          onClick={canOpenAccounting ? () => setActiveModule('accounting') : undefined}
          onKeyDown={
            canOpenAccounting
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('accounting');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-4 sm:p-5 transition-colors',
            canOpenAccounting && 'hover:border-[#1B5E99]/50 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600">
              {tr('Pendapatan Usaha', 'Operating Revenue')}
            </span>
            <TrendingUp className="h-4 w-4 text-[#1B5E99] shrink-0" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
            {formatCompactIdr(incomeStatement.totalRevenueIdr, lang)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums truncate">
            {formatCurrency(incomeStatement.totalRevenueIdr)}
          </div>
        </div>

        <div
          role={canOpenReports ? 'button' : undefined}
          tabIndex={canOpenReports ? 0 : undefined}
          onClick={canOpenReports ? () => setActiveModule('reports') : undefined}
          onKeyDown={
            canOpenReports
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('reports');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-4 sm:p-5 transition-colors',
            canOpenReports && 'hover:border-[#1B5E99]/50 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600">
              {tr('Laba Kotor (Gross Profit)', 'Gross Profit')}
            </span>
            <span className="text-xs font-bold font-mono tabular-nums text-[#1B5E99]">
              {grossMarginPct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
            {formatCompactIdr(incomeStatement.grossProfitIdr, lang)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums truncate">
            {tr('HPP / COGS', 'COGS')}: {formatCompactIdr(incomeStatement.totalCogsIdr, lang)}
          </div>
        </div>

        <div
          role={canOpenAccounting ? 'button' : undefined}
          tabIndex={canOpenAccounting ? 0 : undefined}
          onClick={canOpenAccounting ? () => setActiveModule('accounting') : undefined}
          onKeyDown={
            canOpenAccounting
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('accounting');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-4 sm:p-5 transition-colors',
            canOpenAccounting && 'hover:border-[#1B5E99]/50 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600">
              {tr('Laba Bersih (Net Income)', 'Net Income')}
            </span>
            <span
              className={cn(
                'text-xs font-bold font-mono tabular-nums',
                incomeStatement.netIncomeIdr >= 0 ? 'text-emerald-700' : 'text-red-700'
              )}
            >
              {netMarginPct.toFixed(1)}%
            </span>
          </div>
          <div
            className={cn(
              'mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums truncate',
              incomeStatement.netIncomeIdr >= 0 ? 'text-emerald-800' : 'text-red-700'
            )}
          >
            {formatCompactIdr(incomeStatement.netIncomeIdr, lang)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums truncate">
            {tr('Beban OpEx', 'OpEx')}: {formatCompactIdr(incomeStatement.totalExpensesIdr, lang)}
          </div>
        </div>

        <div
          role={canOpenAccounting ? 'button' : undefined}
          tabIndex={canOpenAccounting ? 0 : undefined}
          onClick={canOpenAccounting ? () => setActiveModule('accounting') : undefined}
          onKeyDown={
            canOpenAccounting
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('accounting');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-4 sm:p-5 transition-colors',
            canOpenAccounting && 'hover:border-[#1B5E99]/50 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600">
              {tr('Kas, Bank & Modal Kerja', 'Cash & Working Capital')}
            </span>
            <Landmark className="h-4 w-4 text-[#B88918] shrink-0" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
            {formatCompactIdr(cashAndBankIdr, lang)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums truncate">
            {tr('Modal Kerja', 'Net WC')}: {formatCompactIdr(netWorkingCapitalIdr, lang)}
          </div>
        </div>
      </div>

      {/* 4 Compact Operational Pulse Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          role={canOpenInventory ? 'button' : undefined}
          tabIndex={canOpenInventory ? 0 : undefined}
          onClick={canOpenInventory ? () => setActiveModule('inventory') : undefined}
          onKeyDown={
            canOpenInventory
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('inventory');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-3.5 transition-colors',
            canOpenInventory && 'hover:border-[#1B5E99]/40 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
            <span>{tr('Nilai Persediaan', 'Inventory Value')}</span>
            <Boxes className="h-3.5 w-3.5 text-[#1B5E99]" />
          </div>
          <div className="mt-1 text-base sm:text-lg font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
            {formatCompactIdr(totalStockValueIdr, lang)}
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums">
            {state.products.length} SKU · {state.warehouses.length} {tr('gudang', 'warehouses')}
          </div>
        </div>

        <div
          role={canOpenPurchasing ? 'button' : undefined}
          tabIndex={canOpenPurchasing ? 0 : undefined}
          onClick={canOpenPurchasing ? () => setActiveModule('purchasing') : undefined}
          onKeyDown={
            canOpenPurchasing
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('purchasing');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-3.5 transition-colors',
            canOpenPurchasing && 'hover:border-[#1B5E99]/40 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
            <span>{tr('PO Aktif (Outstanding)', 'Open Purchase Orders')}</span>
            <ShoppingCart className="h-3.5 w-3.5 text-[#0B1B3A]" />
          </div>
          <div className="mt-1 text-base sm:text-lg font-bold text-[#0B1B3A] font-mono tabular-nums">
            {outstandingPos.length} {tr('Dok', 'Docs')}
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums truncate">
            {formatCompactIdr(outstandingPoValueIdr, lang)}
          </div>
        </div>

        <div
          role={canOpenSales ? 'button' : undefined}
          tabIndex={canOpenSales ? 0 : undefined}
          onClick={canOpenSales ? () => setActiveModule('sales') : undefined}
          onKeyDown={
            canOpenSales
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('sales');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-3.5 transition-colors',
            canOpenSales && 'hover:border-[#1B5E99]/40 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
            <span>{tr('SO Aktif (Outstanding)', 'Open Sales Orders')}</span>
            <ClipboardList className="h-3.5 w-3.5 text-[#B88918]" />
          </div>
          <div className="mt-1 text-base sm:text-lg font-bold text-[#0B1B3A] font-mono tabular-nums">
            {outstandingSos.length} {tr('Order', 'Orders')}
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums truncate">
            {formatCompactIdr(outstandingSoValueIdr, lang)}
          </div>
        </div>

        <div
          role={canOpenAccounting ? 'button' : undefined}
          tabIndex={canOpenAccounting ? 0 : undefined}
          onClick={canOpenAccounting ? () => setActiveModule('accounting') : undefined}
          onKeyDown={
            canOpenAccounting
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModule('accounting');
                  }
                }
              : undefined
          }
          className={cn(
            'text-left rounded-xl border border-slate-200 bg-white p-3.5 transition-colors',
            canOpenAccounting && 'hover:border-[#1B5E99]/40 cursor-pointer'
          )}
        >
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
            <span>{tr('Piutang vs Hutang', 'AR vs AP Balance')}</span>
            <CreditCard className="h-3.5 w-3.5 text-[#1B5E99]" />
          </div>
          <div className="mt-1 text-base sm:text-lg font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
            {formatCompactIdr(totalArIdr, lang)}
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums truncate">
            {tr('Hutang AP', 'AP Due')}: {formatCompactIdr(totalApIdr, lang)}
          </div>
        </div>
      </div>

      {/* Main Interactive Analytics & Financial Position Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        {/* Interactive Dual-Mode Monthly Performance Chart */}
        <Card className="xl:col-span-7 flex flex-col">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>
                {chartMode === 'pnl'
                  ? tr('Tren Omzet, Laba Kotor & Laba Bersih', 'Revenue, Gross Profit & Net Income Trend')
                  : tr('Perbandingan Pembelian (PO) vs Penjualan (SO)', 'Procurement (PO) vs Sales (SO) Comparison')}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {tr(
                  'Ketuk / klik salah satu bulan untuk melihat rincian angka saat presentasi',
                  'Tap or click any month column to inspect detailed figures during meetings'
                )}
              </p>
            </div>
            <div
              role="group"
              aria-label={tr('Mode grafik', 'Chart mode')}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 self-start sm:self-auto shrink-0"
            >
              <button
                type="button"
                onClick={() => setChartMode('pnl')}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer',
                  chartMode === 'pnl' ? 'bg-[#0B1B3A] text-white' : 'text-slate-600 hover:text-[#0B1B3A]'
                )}
              >
                {tr('Omzet & Laba', 'Revenue & P&L')}
              </button>
              <button
                type="button"
                onClick={() => setChartMode('trade')}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer',
                  chartMode === 'trade' ? 'bg-[#0B1B3A] text-white' : 'text-slate-600 hover:text-[#0B1B3A]'
                )}
              >
                {tr('PO vs SO', 'PO vs SO')}
              </button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col justify-between gap-4 pt-2">
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {chartMode === 'pnl' ? (
                <>
                  <span className="flex items-center gap-1.5 font-medium text-[#0B1B3A]">
                    <span className="h-2.5 w-2.5 rounded-xs bg-[#1B5E99] inline-block" />
                    {tr('Pendapatan', 'Revenue')}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-[#0B1B3A]">
                    <span className="h-2.5 w-2.5 rounded-xs bg-[#0B1B3A] inline-block" />
                    {tr('Laba Kotor', 'Gross Profit')}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-[#0B1B3A]">
                    <span className="h-2.5 w-2.5 rounded-xs bg-[#D9AA32] inline-block" />
                    {tr('Laba Bersih', 'Net Income')}
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5 font-medium text-[#0B1B3A]">
                    <span className="h-2.5 w-2.5 rounded-xs bg-[#1B5E99] inline-block" />
                    {tr('Pembelian (PO)', 'Procurement (PO)')}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-[#0B1B3A]">
                    <span className="h-2.5 w-2.5 rounded-xs bg-[#D9AA32] inline-block" />
                    {tr('Penjualan (SO)', 'Sales (SO)')}
                  </span>
                </>
              )}
            </div>

            {/* Chart Viewport */}
            {chartMode === 'pnl' ? (
              chartMonths.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  {tr(
                    'Belum ada jurnal terposting untuk menampilkan tren laba rugi bulanan.',
                    'No posted journal entries yet to display monthly P&L trends.'
                  )}
                </div>
              ) : (
                <>
                  <div className="relative flex-1 min-h-[200px] sm:min-h-[225px] flex flex-col justify-end">
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6">
                      {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                        <div key={ratio} className="flex items-center gap-1.5 sm:gap-2 w-full">
                          <span className="text-[9px] sm:text-[10px] font-mono text-slate-400 w-12 sm:w-16 text-right tabular-nums shrink-0 truncate">
                            {ratio === 0 ? 'Rp 0' : formatCompactIdr(maxPnlVal * ratio, lang)}
                          </span>
                          <div className="flex-1 border-b border-dashed border-slate-200/80" />
                        </div>
                      ))}
                    </div>

                    <div
                      className="relative pl-14 sm:pl-18 grid gap-1.5 sm:gap-3 items-end h-44 sm:h-52 pb-1 z-10"
                      style={{ gridTemplateColumns: `repeat(${chartMonths.length}, minmax(0, 1fr))` }}
                    >
                      {chartMonths.map((m) => {
                        const isSelected = activeMonthDetail?.monthKey === m.monthKey;
                        const revH = m.revenueIdr > 0 ? Math.max(6, Math.round((m.revenueIdr / maxPnlVal) * 165)) : 4;
                        const gpH = m.grossProfitIdr > 0 ? Math.max(6, Math.round((m.grossProfitIdr / maxPnlVal) * 165)) : 4;
                        const niH = m.netIncomeIdr > 0 ? Math.max(6, Math.round((m.netIncomeIdr / maxPnlVal) * 165)) : 4;
                        return (
                          <button
                            key={m.monthKey}
                            type="button"
                            onClick={() => setSelectedMonthKey(m.monthKey)}
                            onMouseEnter={() => setSelectedMonthKey(m.monthKey)}
                            className={cn(
                              'flex flex-col items-center justify-end h-full rounded-t-lg px-1 pt-2 transition-colors cursor-pointer',
                              isSelected ? 'bg-[#EBF3FA]/80' : 'hover:bg-slate-100/60'
                            )}
                            aria-label={`${m.displayLabel}: ${formatCurrency(m.revenueIdr)}`}
                          >
                            <div className="flex items-end gap-0.5 sm:gap-1 justify-center w-full">
                              <div
                                className="w-2.5 sm:w-4 rounded-t bg-[#1B5E99]"
                                style={{ height: `${revH}px` }}
                              />
                              <div
                                className="w-2.5 sm:w-4 rounded-t bg-[#0B1B3A]"
                                style={{ height: `${gpH}px` }}
                              />
                              <div
                                className="w-2.5 sm:w-4 rounded-t bg-[#D9AA32]"
                                style={{ height: `${niH}px` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div
                    className="pl-14 sm:pl-18 grid gap-1.5 sm:gap-3 pt-2 border-t border-slate-200 text-center"
                    style={{ gridTemplateColumns: `repeat(${chartMonths.length}, minmax(0, 1fr))` }}
                  >
                    {chartMonths.map((m) => {
                      const isSelected = activeMonthDetail?.monthKey === m.monthKey;
                      return (
                        <button
                          key={m.monthKey}
                          type="button"
                          onClick={() => setSelectedMonthKey(m.monthKey)}
                          className={cn(
                            'space-y-0.5 min-w-0 rounded py-1 cursor-pointer transition-colors',
                            isSelected ? 'text-[#1B5E99] font-bold' : 'text-[#0B1B3A]'
                          )}
                        >
                          <div className="text-[11px] sm:text-xs font-semibold truncate">
                            {m.displayLabel}
                          </div>
                          <div className="text-[9px] sm:text-[11px] text-slate-500 font-mono tabular-nums truncate">
                            {formatCompactIdr(m.revenueIdr, lang)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )
            ) : (
              <>
                <div className="relative flex-1 min-h-[200px] sm:min-h-[225px] flex flex-col justify-end">
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6">
                    {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                      <div key={ratio} className="flex items-center gap-1.5 sm:gap-2 w-full">
                        <span className="text-[9px] sm:text-[10px] font-mono text-slate-400 w-12 sm:w-16 text-right tabular-nums shrink-0 truncate">
                          {ratio === 0 ? 'Rp 0' : formatCompactIdr(maxTradeVal * ratio, lang)}
                        </span>
                        <div className="flex-1 border-b border-dashed border-slate-200/80" />
                      </div>
                    ))}
                  </div>

                  <div className="relative pl-14 sm:pl-18 grid grid-cols-6 gap-1 sm:gap-3 items-end h-44 sm:h-52 pb-1 z-10">
                    {sixMonthSeries.map((pt, idx) => {
                      const poHeight = Math.max(4, Math.round((pt.pembelianIdr / maxTradeVal) * 165));
                      const soHeight = Math.max(4, Math.round((pt.penjualanIdr / maxTradeVal) * 165));
                      const correspondingMonth = chartMonths[idx];
                      return (
                        <button
                          key={pt.monthLabel}
                          type="button"
                          onClick={() => correspondingMonth && setSelectedMonthKey(correspondingMonth.monthKey)}
                          className="flex flex-col items-center gap-2 h-full justify-end hover:bg-slate-100/60 rounded-t-lg px-1 cursor-pointer"
                          title={`${pt.monthLabel} — PO: ${formatCurrency(pt.pembelianIdr)} | SO: ${formatCurrency(pt.penjualanIdr)}`}
                        >
                          <div className="flex items-end gap-1 sm:gap-1.5 w-full justify-center">
                            <div
                              className="w-3 sm:w-6 rounded-t bg-[#1B5E99]"
                              style={{ height: `${pt.pembelianIdr > 0 ? poHeight : 4}px` }}
                            />
                            <div
                              className="w-3 sm:w-6 rounded-t bg-[#D9AA32]"
                              style={{ height: `${pt.penjualanIdr > 0 ? soHeight : 4}px` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="pl-14 sm:pl-18 grid grid-cols-6 gap-1 sm:gap-3 pt-2 border-t border-slate-200 text-center">
                  {sixMonthSeries.map((pt) => (
                    <div key={pt.monthLabel} className="space-y-0.5 min-w-0">
                      <div className="text-[11px] sm:text-xs font-semibold text-[#0B1B3A] truncate">
                        {pt.monthLabel}
                      </div>
                      <div className="text-[9px] sm:text-[11px] text-slate-500 font-mono tabular-nums truncate">
                        {formatCompactIdr(pt.penjualanIdr, lang)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Selected Month Drilldown Inspector */}
            {activeMonthDetail && (
              <div className="rounded-lg border border-slate-200 bg-[#F4F7FB] p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500">
                    {tr('Fokus Bulan', 'Focused Month')}
                  </div>
                  <div className="font-bold text-[#0B1B3A]">{activeMonthDetail.displayLabel}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">{tr('Omzet', 'Revenue')}</div>
                  <div className="font-bold font-mono tabular-nums text-[#1B5E99]">
                    {formatCompactIdr(activeMonthDetail.revenueIdr, lang)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">
                    {tr('Laba Bersih', 'Net Income')} ({activeMonthDetail.netMarginPercent.toFixed(1)}%)
                  </div>
                  <div
                    className={cn(
                      'font-bold font-mono tabular-nums',
                      activeMonthDetail.netIncomeIdr >= 0 ? 'text-emerald-700' : 'text-red-700'
                    )}
                  >
                    {formatCompactIdr(activeMonthDetail.netIncomeIdr, lang)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">
                    {tr('Aktivitas Order', 'Order Activity')}
                  </div>
                  <div className="font-semibold font-mono tabular-nums text-[#0B1B3A]">
                    {activeMonthDetail.poCount} PO · {activeMonthDetail.soCount} SO
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Financial Position & Aging Breakdown */}
        <Card className="xl:col-span-5 flex flex-col">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>
                {financeTab === 'balance'
                  ? tr('Posisi Neraca & Struktur Modal', 'Balance Sheet & Capital Structure')
                  : tr('Analisis Umur Piutang & Hutang', 'AR & AP Aging Breakdown')}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {financeTab === 'balance'
                  ? tr('Snapshot Aset, Kewajiban & Ekuitas Pemegang Saham', 'Assets, Liabilities & Shareholder Equity snapshot')
                  : tr('Sebaran jatuh tempo tagihan aktif', 'Maturity distribution of open invoices')}
              </p>
            </div>
            <div
              role="group"
              aria-label={tr('Tab keuangan', 'Finance tab')}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 self-start shrink-0"
            >
              <button
                type="button"
                onClick={() => setFinanceTab('balance')}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer',
                  financeTab === 'balance' ? 'bg-[#0B1B3A] text-white' : 'text-slate-600 hover:text-[#0B1B3A]'
                )}
              >
                {tr('Neraca', 'Balance Sheet')}
              </button>
              <button
                type="button"
                onClick={() => setFinanceTab('aging')}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer',
                  financeTab === 'aging' ? 'bg-[#0B1B3A] text-white' : 'text-slate-600 hover:text-[#0B1B3A]'
                )}
              >
                {tr('Umur AR/AP', 'AR/AP Aging')}
              </button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col justify-between gap-4 pt-2">
            {financeTab === 'balance' ? (
              <div className="space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#0B1B3A]">
                      {tr('Total Aset', 'Total Assets')}
                    </span>
                    <span className="font-bold font-mono tabular-nums text-[#0B1B3A]">
                      {formatCurrency(balanceSheet.totalAssetsIdr)}
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
                    {balanceSheet.totalAssetsIdr > 0 && (
                      <>
                        <div
                          className="h-full bg-[#1B5E99]"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((balanceSheet.totalLiabilitiesIdr / balanceSheet.totalAssetsIdr) * 100)
                            )}%`,
                          }}
                          title={`${tr('Kewajiban', 'Liabilities')}: ${formatCurrency(balanceSheet.totalLiabilitiesIdr)}`}
                        />
                        <div
                          className="h-full bg-[#D9AA32]"
                          style={{
                            width: `${Math.max(
                              0,
                              100 -
                                Math.min(
                                  100,
                                  Math.round((balanceSheet.totalLiabilitiesIdr / balanceSheet.totalAssetsIdr) * 100)
                                )
                            )}%`,
                          }}
                          title={`${tr('Ekuitas', 'Equity')}: ${formatCurrency(balanceSheet.totalEquityIdr)}`}
                        />
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-xs bg-[#1B5E99]" />
                      {tr('Kewajiban', 'Liabilities')}:{' '}
                      <strong className="font-mono tabular-nums text-[#0B1B3A]">
                        {formatCompactIdr(balanceSheet.totalLiabilitiesIdr, lang)}
                      </strong>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-xs bg-[#D9AA32]" />
                      {tr('Ekuitas', 'Equity')}:{' '}
                      <strong className="font-mono tabular-nums text-[#0B1B3A]">
                        {formatCompactIdr(balanceSheet.totalEquityIdr, lang)}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 border-t border-slate-200 text-xs">
                  <div className="py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-600">{tr('Kas Kecil & Rekening Bank', 'Cash & Bank Balances')}</span>
                    <span className="font-semibold font-mono tabular-nums text-[#0B1B3A]">
                      {formatCurrency(cashAndBankIdr)}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-600">{tr('Piutang Usaha Aktif (AR)', 'Open Receivables (AR)')}</span>
                    <span className="font-semibold font-mono tabular-nums text-[#1B5E99]">
                      {formatCurrency(totalArIdr)}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-600">{tr('Valuasi Stok Gudang', 'Warehouse Stock Valuation')}</span>
                    <span className="font-semibold font-mono tabular-nums text-[#0B1B3A]">
                      {formatCurrency(totalStockValueIdr)}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-600">{tr('Hutang Supplier Aktif (AP)', 'Open Payables (AP)')}</span>
                    <span className="font-semibold font-mono tabular-nums text-[#B88918]">
                      {formatCurrency(totalApIdr)}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#0B1B3A]">{tr('Modal Kerja Bersih', 'Net Working Capital')}</span>
                    <span className="font-bold font-mono tabular-nums text-emerald-700">
                      {formatCurrency(netWorkingCapitalIdr)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 text-xs">
                  <StatusLabel
                    status={
                      balanceSheet.isBalanced
                        ? tr('Neraca Seimbang (A = L + E)', 'Balanced (A = L + E)')
                        : tr('Selisih Neraca Terdeteksi', 'Balance Discrepancy')
                    }
                    tone={balanceSheet.isBalanced ? 'success' : 'warning'}
                  />
                  {canOpenAccounting && (
                    <button
                      type="button"
                      onClick={() => setActiveModule('accounting')}
                      className="font-semibold text-[#1B5E99] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      {tr('Detail Laporan', 'Full Statements')} <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setAgingLedger('AR')}
                      className={cn(
                        'px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors',
                        agingLedger === 'AR' ? 'bg-[#1B5E99] text-white' : 'text-slate-600'
                      )}
                    >
                      {tr('Piutang (AR)', 'Receivables (AR)')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgingLedger('AP')}
                      className={cn(
                        'px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors',
                        agingLedger === 'AP' ? 'bg-[#1B5E99] text-white' : 'text-slate-600'
                      )}
                    >
                      {tr('Hutang (AP)', 'Payables (AP)')}
                    </button>
                  </div>
                  <span className="text-xs font-bold font-mono tabular-nums text-[#0B1B3A]">
                    {formatCompactIdr(activeAgingTotal, lang)}
                  </span>
                </div>

                <div className="space-y-3">
                  {AGING_BUCKETS.map((bucket) => {
                    const val = activeAgingSummary[bucket] || 0;
                    const pct = activeAgingTotal > 0 ? Math.round((val / activeAgingTotal) * 100) : 0;
                    const isOverdueBucket = bucket !== 'Belum Jatuh Tempo';
                    return (
                      <div key={bucket} className="space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700">
                            {formatAgingBucketLabel(bucket, lang)}
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-[#0B1B3A]">
                            {formatCurrency(val)} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              !isOverdueBucket
                                ? 'bg-[#1B5E99]'
                                : bucket === '> 90 Hari'
                                ? 'bg-red-600'
                                : 'bg-[#D9AA32]'
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {canOpenAccounting && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveModule('accounting')}
                      className="text-xs font-semibold text-[#1B5E99] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      {tr('Kelola Pembayaran Invoice', 'Manage Invoice Payments')} <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Interactive Split: Partner/Category Contribution + Operational Pipeline & Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        {/* Top Customers, Top Suppliers & Stock Categories */}
        <Card className="xl:col-span-6 flex flex-col">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>{tr('Kontribusi Mitra & Portofolio Stok', 'Partner Contributions & Stock Mix')}</CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {tr('Konsentrasi omzet pelanggan, supplier & kategori persediaan', 'Revenue concentration, vendor spend & stock categories')}
              </p>
            </div>
            <div
              role="group"
              aria-label={tr('Kategori peringkat', 'Ranking category')}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 self-start shrink-0 overflow-x-auto max-w-full"
            >
              {(
                [
                  { id: 'customers', idLabel: 'Customer', enLabel: 'Customers' },
                  { id: 'suppliers', idLabel: 'Supplier', enLabel: 'Suppliers' },
                  { id: 'categories', idLabel: 'Stok', enLabel: 'Stock' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRankingTab(tab.id)}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer',
                    rankingTab === tab.id ? 'bg-[#0B1B3A] text-white' : 'text-slate-600 hover:text-[#0B1B3A]'
                  )}
                >
                  {lang === 'en' ? tab.enLabel : tab.idLabel}
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-3 pt-2">
            {activeRankingList.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <p className="text-xs text-slate-500">
                  {tr(
                    'Belum ada transaksi pada periode yang dipilih.',
                    'No transactions recorded for the selected period.'
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPeriod('all')}
                >
                  {tr('Tampilkan Semua Periode', 'Show All Periods')}
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto pr-1">
                {activeRankingList.map((item, idx) => (
                  <div key={item.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-slate-400 w-4 shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="font-semibold text-[#0B1B3A] truncate">{item.name}</span>
                        <span className="text-[11px] text-slate-500 shrink-0">
                          · {item.count}{' '}
                          {rankingTab === 'categories'
                            ? 'SKU'
                            : rankingTab === 'customers'
                            ? 'SO'
                            : 'PO'}
                        </span>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <span className="font-bold text-[#0B1B3A]">
                          {formatCompactIdr(item.amountIdr, lang)}
                        </span>
                        <span className="text-[11px] text-slate-500 ml-1.5">
                          ({item.sharePercent.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          rankingTab === 'customers'
                            ? 'bg-[#D9AA32]'
                            : rankingTab === 'suppliers'
                            ? 'bg-[#1B5E99]'
                            : 'bg-[#0B1B3A]'
                        )}
                        style={{ width: `${Math.max(4, Math.min(100, item.sharePercent))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actionable Alerts & Order Pipeline */}
        <Card className="xl:col-span-6 flex flex-col">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>
                {opsTab === 'alerts'
                  ? tr(`Peringatan Prioritas (${totalAlertCount})`, `Priority Watchlist (${totalAlertCount})`)
                  : tr('Status Pipeline PO & SO', 'PO & SO Order Pipeline')}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {opsTab === 'alerts'
                  ? tr('Item operasional yang memerlukan keputusan manajemen', 'Operational items requiring management follow-up')
                  : tr('Distribusi status pengadaan barang dan pemenuhan order customer', 'Procurement and customer fulfillment status distribution')}
              </p>
            </div>
            <div
              role="group"
              aria-label={tr('Tab operasional', 'Operational tab')}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 self-start shrink-0"
            >
              <button
                type="button"
                onClick={() => setOpsTab('alerts')}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer',
                  opsTab === 'alerts' ? 'bg-[#0B1B3A] text-white' : 'text-slate-600 hover:text-[#0B1B3A]'
                )}
              >
                {tr('Peringatan', 'Alerts')} ({totalAlertCount})
              </button>
              <button
                type="button"
                onClick={() => setOpsTab('pipeline')}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer',
                  opsTab === 'pipeline' ? 'bg-[#0B1B3A] text-white' : 'text-slate-600 hover:text-[#0B1B3A]'
                )}
              >
                {tr('Pipeline Order', 'Order Pipeline')}
              </button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-4 pt-2">
            {opsTab === 'alerts' ? (
              totalAlertCount === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                  <p className="text-xs font-semibold text-[#0B1B3A]">
                    {tr('Operasional Dalam Kondisi Optimal', 'Operations Running Smoothly')}
                  </p>
                  <p className="text-xs text-slate-500">
                    {tr(
                      'Tidak ada stok kritis, PO terlambat, atau invoice jatuh tempo saat ini.',
                      'No low-stock SKUs, overdue POs, or overdue invoices at this time.'
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {lowStockProducts.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-[#0B1B3A]">
                        <span>{tr(`Stok Kritis (${lowStockProducts.length})`, `Low Stock (${lowStockProducts.length})`)}</span>
                        {canOpenInventory && (
                          <button
                            type="button"
                            onClick={() => setActiveModule('inventory')}
                            className="text-[#1B5E99] hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            {tr('Ke Inventory', 'Open Inventory')} <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                        {lowStockProducts.slice(0, 2).map((p) => (
                          <div
                            key={p.id}
                            role={canOpenInventory ? 'button' : undefined}
                            tabIndex={canOpenInventory ? 0 : undefined}
                            onClick={canOpenInventory ? () => setActiveModule('inventory') : undefined}
                            onKeyDown={
                              canOpenInventory
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setActiveModule('inventory');
                                    }
                                  }
                                : undefined
                            }
                            className={cn(
                              'w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition-colors',
                              canOpenInventory && 'hover:bg-slate-50 cursor-pointer'
                            )}
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-[#0B1B3A] truncate">{p.name}</div>
                              <div className="text-slate-500 font-mono text-[11px]">{p.sku}</div>
                            </div>
                            <StatusLabel
                              status={`${getTotalProductStock(p)} / min ${p.minStock}`}
                              tone="danger"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {overduePos.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-[#0B1B3A]">
                        <span>{tr(`PO Melewati Target Kirim (${overduePos.length})`, `Overdue POs (${overduePos.length})`)}</span>
                        {canOpenPurchasing && (
                          <button
                            type="button"
                            onClick={() => setActiveModule('purchasing')}
                            className="text-[#1B5E99] hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            {tr('Tindak Lanjut', 'Follow Up')} <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                        {overduePos.slice(0, 2).map((po) => (
                          <div
                            key={po.id}
                            role={canOpenPurchasing ? 'button' : undefined}
                            tabIndex={canOpenPurchasing ? 0 : undefined}
                            onClick={canOpenPurchasing ? () => setActiveModule('purchasing') : undefined}
                            onKeyDown={
                              canOpenPurchasing
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setActiveModule('purchasing');
                                    }
                                  }
                                : undefined
                            }
                            className={cn(
                              'w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition-colors',
                              canOpenPurchasing && 'hover:bg-slate-50 cursor-pointer'
                            )}
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-[#0B1B3A] truncate">
                                {po.poNumber} · {po.supplierName}
                              </div>
                              <div className="text-slate-500 text-[11px]">
                                {tr('Target', 'ETA')}: {po.expectedDate}
                              </div>
                            </div>
                            <StatusLabel status={po.status} tone="warning" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {overdueInvoices.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-[#0B1B3A]">
                        <span>{tr(`Invoice Jatuh Tempo (${overdueInvoices.length})`, `Overdue Invoices (${overdueInvoices.length})`)}</span>
                        {canOpenAccounting && (
                          <button
                            type="button"
                            onClick={() => setActiveModule('accounting')}
                            className="text-[#1B5E99] hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            {tr('Ke Akunting', 'Open Ledger')} <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                        {overdueInvoices.slice(0, 2).map((inv) => (
                          <div
                            key={inv.id}
                            role={canOpenAccounting ? 'button' : undefined}
                            tabIndex={canOpenAccounting ? 0 : undefined}
                            onClick={canOpenAccounting ? () => setActiveModule('accounting') : undefined}
                            onKeyDown={
                              canOpenAccounting
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setActiveModule('accounting');
                                    }
                                  }
                                : undefined
                            }
                            className={cn(
                              'w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition-colors',
                              canOpenAccounting && 'hover:bg-slate-50 cursor-pointer'
                            )}
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-[#0B1B3A] truncate">
                                {inv.invoiceNumber} ({inv.ledgerType})
                              </div>
                              <div className="text-slate-500 truncate text-[11px]">{inv.counterpartyName}</div>
                            </div>
                            <span className="font-mono font-semibold text-red-700 tabular-nums shrink-0">
                              {formatCurrency(inv.balanceDue, inv.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#0B1B3A]">
                    <span>{tr('Pipeline Purchase Order', 'Purchase Order Pipeline')}</span>
                    {canOpenPurchasing ? (
                      <button
                        type="button"
                        onClick={() => setActiveModule('purchasing')}
                        className="text-[#1B5E99] hover:underline cursor-pointer"
                      >
                        {state.purchaseOrders.length} PO
                      </button>
                    ) : (
                      <span className="text-slate-500 font-mono">{state.purchaseOrders.length} PO</span>
                    )}
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {poPipelineStats.map((g) => (
                      <div key={g.label} className="px-3 py-2 flex items-center justify-between text-xs">
                        <span className="text-slate-600">{g.label}</span>
                        <StatusLabel status={String(g.count)} tone={g.tone} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#0B1B3A]">
                    <span>{tr('Pipeline Sales Order', 'Sales Order Pipeline')}</span>
                    {canOpenSales ? (
                      <button
                        type="button"
                        onClick={() => setActiveModule('sales')}
                        className="text-[#1B5E99] hover:underline cursor-pointer"
                      >
                        {state.salesOrders.length} SO
                      </button>
                    ) : (
                      <span className="text-slate-500 font-mono">{state.salesOrders.length} SO</span>
                    )}
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {soPipelineStats.map((g) => (
                      <div key={g.label} className="px-3 py-2 flex items-center justify-between text-xs">
                        <span className="text-slate-600">{g.label}</span>
                        <StatusLabel status={String(g.count)} tone={g.tone} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {totalAlertCount > 0 && opsTab === 'pipeline' && (
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-[#FDF7E3] px-3 py-2 text-xs">
                <span className="flex items-center gap-2 font-medium text-[#8F670D]">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {tr(
                    `Ada ${totalAlertCount} item prioritas perlu perhatian.`,
                    `${totalAlertCount} priority items need attention.`
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setOpsTab('alerts')}
                  className="font-semibold text-[#0B1B3A] hover:underline cursor-pointer"
                >
                  {tr('Tinjau', 'Review')}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Budget vs Actual Executive Tracking (Visible to Directors, Managers, Finance & Angel Investor) */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[#D9AA32] shrink-0" />
            <div>
              <CardTitle>
                {tr('Target & Realisasi Budget Bulanan (Budget vs Actual)', 'Monthly Budget vs Actual Performance')}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {tr(
                  'Perbandingan target omzet, pagu HPP/OpEx, dan pencapaian laba bersih terhadap rencana manajemen.',
                  'Comparison of revenue targets, COGS/OpEx caps, and net income attainment vs management plan.'
                )}
              </p>
            </div>
          </div>
          {canOpenAccounting && !meetingMode && (
            <button
              type="button"
              onClick={() => setActiveModule('accounting')}
              className="text-xs font-semibold text-[#1B5E99] hover:underline inline-flex items-center gap-1 cursor-pointer self-start sm:self-auto"
            >
              {tr('Kelola Budget & Tutup Buku', 'Manage Budget & Close')} <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </CardHeader>
        <CardContent>
          {budgetRows.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              {tr(
                'Belum ada target budget bulanan yang ditetapkan.',
                'No monthly budget targets configured yet.'
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {budgetRows.slice(-3).reverse().map((b) => {
                const pct = Math.min(100, Math.max(0, Math.round(b.revenueAttainmentPercent)));
                const onTrack = b.revenueAttainmentPercent >= 85;
                return (
                  <div
                    key={b.periodKey}
                    className="rounded-xl border border-slate-200 bg-[#F4F7FB]/80 p-3.5 space-y-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#0B1B3A] text-sm">{b.monthLabel}</span>
                      <StatusLabel
                        status={`${b.revenueAttainmentPercent.toFixed(1)}% ${tr('Target', 'Attained')}`}
                        tone={onTrack ? 'success' : 'warning'}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-600">
                        <span>{tr('Omzet Aktual / Target', 'Revenue Actual / Target')}</span>
                        <span className="font-mono font-semibold text-[#0B1B3A]">
                          {formatCompactIdr(b.actualRevenueIdr, lang)} / {formatCompactIdr(b.targetRevenueIdr, lang)}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            onTrack ? 'bg-emerald-600' : 'bg-[#D9AA32]'
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-200/80 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">HPP</span>
                        <span className="font-mono font-semibold text-[#0B1B3A]">
                          {formatCompactIdr(b.actualCogsIdr, lang)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">OpEx</span>
                        <span className="font-mono font-semibold text-[#0B1B3A]">
                          {formatCompactIdr(b.actualOpexIdr, lang)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 block">{tr('Laba Bersih', 'Net Inc')}</span>
                        <span
                          className={cn(
                            'font-mono font-bold',
                            b.actualNetIncomeIdr >= b.targetNetIncomeIdr ? 'text-emerald-700' : 'text-amber-700'
                          )}
                        >
                          {formatCompactIdr(b.actualNetIncomeIdr, lang)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operational Smart Follow-Up & Alert Drafts (Strictly hidden from Angel Investor & Viewer) */}
      {!isDashboardOnlyRole && !meetingMode && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>
                {tr(
                  `Smart Follow-Up & Draft Pengingat Operasional (${reminderDrafts.length})`,
                  `Operational Smart Follow-Up Drafts (${reminderDrafts.length})`
                )}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {tr(
                  'Tindakan cepat WhatsApp / Email untuk penagihan AR jatuh tempo, approval PO, restock, dan batch expired.',
                  'Quick WhatsApp / Email follow-up drafts for overdue AR, pending PO approvals, restocks, and expiring batches.'
                )}
              </p>
            </div>
            {canOpenModule('system') && (
              <button
                type="button"
                onClick={() => setActiveModule('system')}
                className="text-xs font-semibold text-[#1B5E99] hover:underline inline-flex items-center gap-1 cursor-pointer self-start sm:self-auto"
              >
                {tr('Semua Draft di Sistem', 'All Drafts in System')} <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </CardHeader>
          <CardContent>
            {reminderDrafts.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                {tr('Tidak ada item follow-up mendesak saat ini.', 'No urgent follow-up items right now.')}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {reminderDrafts.slice(0, 4).map((d) => (
                  <div
                    key={d.id}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2 text-xs flex flex-col justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
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
                        <span className="text-[11px] text-slate-500 truncate">{d.recipientName}</span>
                      </div>
                      <div className="font-semibold text-[#0B1B3A]">{d.subject}</div>
                      <p className="text-[11px] text-slate-600 line-clamp-2">{d.message}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopyDraft(d.id, d.message)}
                      >
                        {copiedDraftId === d.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedDraftId === d.id ? tr('Disalin', 'Copied') : tr('Salin', 'Copy')}
                      </Button>
                      {d.whatsappUrl && (
                        <a
                          href={d.whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 min-h-[34px] text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          WhatsApp
                        </a>
                      )}
                      {d.mailtoUrl && (
                        <a
                          href={d.mailtoUrl}
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#BFD9EF] bg-[#EBF3FA] px-2.5 min-h-[34px] text-[11px] font-semibold text-[#154C7E] hover:bg-[#dcebf7] transition-colors"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Email
                        </a>
                      )}
                      {canOpenModule(d.targetModule) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveModule(d.targetModule)}
                        >
                          {tr('Buka', 'Open')} <ArrowRight className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
