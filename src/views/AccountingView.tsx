import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Landmark,
  Layers,
  Lock,
  Pencil,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Scale,
  Search,
  Sparkles,
  Target,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePrintDocument } from '../components/PrintableDocumentModal';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
} from '../components/ui/primitives';
import type { ErpController } from '../controllers/useErpController';
import { useI18n } from '../lib/i18n';
import {
  computeBalanceSheet,
  computeBudgetVsActual,
  computeIncomeStatement,
  computeLedgerStatement,
  computeMonthlyPerformance,
  computeThreeWayMatchStatus,
  computeTrialBalance,
  convertToIdr,
  findSeededDummyAccountingTargets,
  formatCompactIdr,
  formatCurrency,
  getCashBankAccounts,
  isCashBankAccount,
  summarizeAgingReport,
  validateBalancedJournalLines,
  type AgingBucket,
} from '../models/erpLogic';
import {
  buildPaymentReceiptPrintDoc,
  buildSalesInvoicePrintDoc,
} from '../models/printDocumentModel';
import { hasPermission } from '../models/rbac';
import { createInitialSeedState } from '../models/seedData';
import type {
  AccountCategory,
  AccountingInvoice,
  ChartAccount,
  InvoiceStatus,
  JournalEntry,
  JournalEntryType,
  NormalBalance,
} from '../models/types';
import {
  exportIncomeStatementPdf,
  exportMonthlyPerformancePdf,
  exportPaymentReceiptPdf,
  exportSalesInvoicePdf,
  exportTableToCsv,
  exportTableToExcel,
  exportTableToPdf,
} from '../services/exportService';

function getInvTone(st: InvoiceStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (st) {
    case 'PAID':
      return 'success';
    case 'PARTIAL':
      return 'warning';
    case 'OVERDUE':
      return 'danger';
    default:
      return 'neutral';
  }
}

function getCategoryTone(
  cat: AccountCategory
): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  switch (cat) {
    case 'Aset':
      return 'info';
    case 'Kewajiban':
      return 'warning';
    case 'Ekuitas':
      return 'neutral';
    case 'Pendapatan':
      return 'success';
    case 'Beban':
      return 'danger';
  }
}

function sanitizeIntegerDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
}

interface DraftJournalLine {
  key: string;
  accountId: string;
  debitIdr: string;
  creditIdr: string;
  memo: string;
}

export function AccountingView({ erp }: { erp: ErpController }) {
  const { state, currentUser } = erp;
  const { lang, tr } = useI18n();
  const { openPrintPreview } = usePrintDocument();
  const canWrite = hasPermission(currentUser?.role, 'accounting:write');
  const canClosePeriod = hasPermission(currentUser?.role, 'period:close');
  const canWriteBudget = hasPermission(currentUser?.role, 'budget:write');
  const isDirektur = hasPermission(currentUser?.role, 'master:users');
  const rate = state.settings.defaultExchangeRateUsdIdr;

  const sortedAccounts = useMemo(
    () => state.chartOfAccounts.slice().sort((a, b) => a.code.localeCompare(b.code)),
    [state.chartOfAccounts]
  );

  const cashBankAccounts = useMemo(
    () => getCashBankAccounts(state.chartOfAccounts),
    [state.chartOfAccounts]
  );

  const accountById = useMemo(() => {
    const map = new Map<string, ChartAccount>();
    for (const acc of state.chartOfAccounts) {
      map.set(acc.id, acc);
    }
    return map;
  }, [state.chartOfAccounts]);

  const sortedJournals = useMemo(
    () =>
      state.journalEntries
        .slice()
        .sort((a, b) => {
          if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [state.journalEntries]
  );

  // Active tab state
  const [activeTab, setActiveTab] = useState<string>('ledger');

  // Ledger (Buku Besar) filters
  const defaultAccountId = useMemo(() => {
    const mandiri = sortedAccounts.find((a) => a.id === 'coa_1102' || a.code === '1102');
    return mandiri?.id || sortedAccounts[0]?.id || 'ALL';
  }, [sortedAccounts]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const effectiveAccountId =
    selectedAccountId && (selectedAccountId === 'ALL' || sortedAccounts.some((a) => a.id === selectedAccountId))
      ? selectedAccountId
      : defaultAccountId;

  const [ledgerStartDate, setLedgerStartDate] = useState<string>('');
  const [ledgerEndDate, setLedgerEndDate] = useState<string>('');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');

  // Journal Umum filters
  const [journalTypeFilter, setJournalTypeFilter] = useState<string>('ALL');
  const [journalStatusFilter, setJournalStatusFilter] = useState<string>('ALL');
  const [journalSearch, setJournalSearch] = useState<string>('');

  // CoA filters
  const [coaCategoryFilter, setCoaCategoryFilter] = useState<string>('ALL');
  const [coaSearch, setCoaSearch] = useState<string>('');

  // AP/AR filters
  const [invoiceLedgerFilter, setInvoiceLedgerFilter] = useState<'ALL' | 'AP' | 'AR'>('ALL');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>('ALL');

  // Modals state
  const [viewJournal, setViewJournal] = useState<JournalEntry | null>(null);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [jrnDate, setJrnDate] = useState('2026-11-22');
  const [jrnType, setJrnType] = useState<JournalEntryType>('Jurnal Umum');
  const [jrnRefNo, setJrnRefNo] = useState('');
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnLines, setJrnLines] = useState<DraftJournalLine[]>([]);
  const [jrnSaving, setJrnSaving] = useState(false);

  const [coaModal, setCoaModal] = useState<{
    open: boolean;
    isNew: boolean;
    id?: string;
    code: string;
    name: string;
    category: AccountCategory;
    normalBalance: NormalBalance;
    openingBalanceIdr: string;
    description: string;
    active: boolean;
  }>({
    open: false,
    isNew: true,
    code: '',
    name: '',
    category: 'Beban',
    normalBalance: 'Debit',
    openingBalanceIdr: '0',
    description: '',
    active: true,
  });

  const [payInvoice, setPayInvoice] = useState<AccountingInvoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payMethod, setPayMethod] = useState('Transfer Bank');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const [taxModalInv, setTaxModalInv] = useState<{ inv: AccountingInvoice; taxNo: string } | null>(null);
  const [receiptModalInv, setReceiptModalInv] = useState<AccountingInvoice | null>(null);

  const [closingMonth, setClosingMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [closingNotes, setClosingNotes] = useState('');
  const [closingBusy, setClosingBusy] = useState(false);

  const [budgetMonth, setBudgetMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [budgetTargetRev, setBudgetTargetRev] = useState('350000000');
  const [budgetMaxCogs, setBudgetMaxCogs] = useState('220000000');
  const [budgetMaxOpex, setBudgetMaxOpex] = useState('45000000');
  const [budgetNotes, setBudgetNotes] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    tone: 'danger' | 'warning';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Core Financial Computations
  const trialBalance = useMemo(
    () => computeTrialBalance(state.chartOfAccounts, state.journalEntries, ledgerStartDate || undefined, ledgerEndDate || undefined),
    [ledgerEndDate, ledgerStartDate, state.chartOfAccounts, state.journalEntries]
  );

  const allTimeTrialBalance = useMemo(
    () => computeTrialBalance(state.chartOfAccounts, state.journalEntries),
    [state.chartOfAccounts, state.journalEntries]
  );

  const incomeStatement = useMemo(
    () => computeIncomeStatement(state.chartOfAccounts, state.journalEntries, ledgerStartDate || undefined, ledgerEndDate || undefined),
    [ledgerEndDate, ledgerStartDate, state.chartOfAccounts, state.journalEntries]
  );

  const allTimeIncomeStatement = useMemo(
    () => computeIncomeStatement(state.chartOfAccounts, state.journalEntries),
    [state.chartOfAccounts, state.journalEntries]
  );

  const balanceSheet = useMemo(
    () => computeBalanceSheet(state.chartOfAccounts, state.journalEntries, ledgerEndDate || undefined),
    [ledgerEndDate, state.chartOfAccounts, state.journalEntries]
  );

  const monthlyPerformance = useMemo(
    () =>
      computeMonthlyPerformance(
        state.chartOfAccounts,
        state.journalEntries,
        state.purchaseOrders,
        state.salesOrders,
        rate
      ),
    [rate, state.chartOfAccounts, state.journalEntries, state.purchaseOrders, state.salesOrders]
  );

  const budgetRows = useMemo(
    () => computeBudgetVsActual(state.budgets, monthlyPerformance, lang),
    [lang, monthlyPerformance, state.budgets]
  );

  const activeAccount = useMemo(
    () => sortedAccounts.find((a) => a.id === effectiveAccountId) || null,
    [effectiveAccountId, sortedAccounts]
  );

  const activeLedgerStatement = useMemo(() => {
    if (!activeAccount) return null;
    return computeLedgerStatement(
      activeAccount,
      state.journalEntries,
      ledgerStartDate || undefined,
      ledgerEndDate || undefined
    );
  }, [activeAccount, ledgerEndDate, ledgerStartDate, state.journalEntries]);

  const filteredLedgerRows = useMemo(() => {
    if (!activeLedgerStatement) return [];
    const q = ledgerSearch.trim().toLowerCase();
    if (!q) return activeLedgerStatement.rows;
    return activeLedgerStatement.rows.filter(
      (r) =>
        r.entryNumber.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.referenceNumber || '').toLowerCase().includes(q) ||
        (r.memo || '').toLowerCase().includes(q)
    );
  }, [activeLedgerStatement, ledgerSearch]);

  const allAccountFlatLines = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    const list: Array<{
      entry: JournalEntry;
      accountCode: string;
      accountName: string;
      memo?: string;
      debitIdr: number;
      creditIdr: number;
    }> = [];
    const chronological = state.journalEntries
      .filter((j) => j.status === 'Posted')
      .filter((j) => (!ledgerStartDate || j.entryDate >= ledgerStartDate) && (!ledgerEndDate || j.entryDate <= ledgerEndDate))
      .slice()
      .sort((a, b) => {
        if (a.entryDate !== b.entryDate) return a.entryDate.localeCompare(b.entryDate);
        return a.createdAt.localeCompare(b.createdAt);
      });

    for (const entry of chronological) {
      for (const line of entry.lines) {
        const liveAcc = accountById.get(line.accountId);
        const resolvedCode = liveAcc?.code || line.accountCode;
        const resolvedName = liveAcc?.name || line.accountName;
        if (
          q &&
          !entry.entryNumber.toLowerCase().includes(q) &&
          !entry.description.toLowerCase().includes(q) &&
          !resolvedCode.toLowerCase().includes(q) &&
          !resolvedName.toLowerCase().includes(q) &&
          !(line.memo || '').toLowerCase().includes(q)
        ) {
          continue;
        }
        list.push({
          entry,
          accountCode: resolvedCode,
          accountName: resolvedName,
          memo: line.memo,
          debitIdr: line.debitIdr,
          creditIdr: line.creditIdr,
        });
      }
    }
    return list;
  }, [accountById, ledgerEndDate, ledgerSearch, ledgerStartDate, state.journalEntries]);

  // KPI strip values
  const totalCashBankIdr = useMemo(() => {
    return allTimeTrialBalance.rows
      .filter((r) => isCashBankAccount(r.account))
      .reduce((s, r) => s + r.closingBalanceIdr, 0);
  }, [allTimeTrialBalance.rows]);

  const totalArIdr = useMemo(
    () =>
      state.invoices
        .filter((i) => i.ledgerType === 'AR' && i.balanceDue > 0)
        .reduce((sum, i) => sum + convertToIdr(i.balanceDue, i.currency, i.exchangeRate || rate), 0),
    [rate, state.invoices]
  );

  const totalApIdr = useMemo(
    () =>
      state.invoices
        .filter((i) => i.ledgerType === 'AP' && i.balanceDue > 0)
        .reduce((sum, i) => sum + convertToIdr(i.balanceDue, i.currency, i.exchangeRate || rate), 0),
    [rate, state.invoices]
  );

  // Draft journal validation
  const draftValidation = useMemo(
    () =>
      validateBalancedJournalLines(
        jrnLines.map((l) => ({
          accountId: l.accountId,
          debitIdr: Number(l.debitIdr) || 0,
          creditIdr: Number(l.creditIdr) || 0,
        }))
      ),
    [jrnLines]
  );

  const missingDebitForBalance = Math.max(
    0,
    draftValidation.totalCreditIdr - draftValidation.totalDebitIdr
  );
  const missingCreditForBalance = Math.max(
    0,
    draftValidation.totalDebitIdr - draftValidation.totalCreditIdr
  );

  // Filtered lists
  const filteredJournals = useMemo(() => {
    const q = journalSearch.trim().toLowerCase();
    return sortedJournals.filter((j) => {
      if (journalTypeFilter !== 'ALL' && j.journalType !== journalTypeFilter) return false;
      if (journalStatusFilter !== 'ALL' && j.status !== journalStatusFilter) return false;
      if (q) {
        const hit =
          j.entryNumber.toLowerCase().includes(q) ||
          j.description.toLowerCase().includes(q) ||
          (j.referenceNumber || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [journalSearch, journalStatusFilter, journalTypeFilter, sortedJournals]);

  const filteredCoaRows = useMemo(() => {
    const q = coaSearch.trim().toLowerCase();
    return allTimeTrialBalance.rows.filter((r) => {
      if (coaCategoryFilter !== 'ALL' && r.account.category !== coaCategoryFilter) return false;
      if (q && !r.account.code.toLowerCase().includes(q) && !r.account.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allTimeTrialBalance.rows, coaCategoryFilter, coaSearch]);

  const filteredInvoices = useMemo(() => {
    return state.invoices.filter((i) => {
      if (invoiceLedgerFilter !== 'ALL' && i.ledgerType !== invoiceLedgerFilter) return false;
      if (invoiceStatusFilter !== 'ALL' && i.status !== invoiceStatusFilter) return false;
      return true;
    });
  }, [invoiceLedgerFilter, invoiceStatusFilter, state.invoices]);

  const dummyJournalCount = useMemo(
    () => findSeededDummyAccountingTargets(state, createInitialSeedState()).length,
    [state]
  );

  const apAging = summarizeAgingReport(state.invoices, 'AP', rate);
  const arAging = summarizeAgingReport(state.invoices, 'AR', rate);
  const agingBuckets: AgingBucket[] = [
    'Belum Jatuh Tempo',
    '1-30 Hari',
    '31-60 Hari',
    '61-90 Hari',
    '> 90 Hari',
  ];

  // Handlers
  const openCreateJournalModal = () => {
    const defaultDebitAcc = sortedAccounts.find((a) => a.code === '6104')?.id || sortedAccounts[0]?.id || '';
    const defaultCreditAcc = sortedAccounts.find((a) => a.code === '1102')?.id || sortedAccounts[1]?.id || sortedAccounts[0]?.id || '';
    setJrnDate(new Date().toISOString().slice(0, 10));
    setJrnType('Jurnal Umum');
    setJrnRefNo('');
    setJrnDesc('');
    setJrnLines([
      { key: 'line_1', accountId: defaultDebitAcc, debitIdr: '', creditIdr: '', memo: '' },
      { key: 'line_2', accountId: defaultCreditAcc, debitIdr: '', creditIdr: '', memo: '' },
    ]);
    setShowJournalModal(true);
  };

  const openPaymentModal = (inv: AccountingInvoice) => {
    const defaultCashAcc =
      cashBankAccounts.find((a) => a.id === 'coa_1102' || a.code === '1102') ||
      cashBankAccounts[0] ||
      sortedAccounts.find((a) => a.active);
    setPayInvoice(inv);
    setPayAmount(String(inv.balanceDue));
    setPayAccountId(defaultCashAcc?.id || '');
    const accNameLower = (defaultCashAcc?.name || '').toLowerCase();
    setPayMethod(accNameLower.includes('kas') ? 'Kas Tunai' : 'Transfer Bank');
    setPayRef(`TRX-${Date.now().toString().slice(-6)}`);
    setPayNotes('');
  };

  const openCoaModal = (acc?: ChartAccount) => {
    if (acc) {
      setCoaModal({
        open: true,
        isNew: false,
        id: acc.id,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normalBalance: acc.normalBalance,
        openingBalanceIdr: String(acc.openingBalanceIdr || 0),
        description: acc.description || '',
        active: acc.active,
      });
    } else {
      setCoaModal({
        open: true,
        isNew: true,
        code: '',
        name: '',
        category: 'Beban',
        normalBalance: 'Debit',
        openingBalanceIdr: '0',
        description: '',
        active: true,
      });
    }
  };

  const handleDebitChange = (lineKey: string, rawValue: string) => {
    const sanitized = sanitizeIntegerDigits(rawValue);
    setJrnLines((prev) =>
      prev.map((x) =>
        x.key === lineKey
          ? {
              ...x,
              debitIdr: sanitized,
              creditIdr: Number(sanitized) > 0 ? '' : x.creditIdr,
            }
          : x
      )
    );
  };

  const handleCreditChange = (lineKey: string, rawValue: string) => {
    const sanitized = sanitizeIntegerDigits(rawValue);
    setJrnLines((prev) =>
      prev.map((x) =>
        x.key === lineKey
          ? {
              ...x,
              creditIdr: sanitized,
              debitIdr: Number(sanitized) > 0 ? '' : x.debitIdr,
            }
          : x
      )
    );
  };

  const handleExportBukuBesarExcel = () => {
    if (effectiveAccountId === 'ALL' || !activeLedgerStatement) {
      exportTableToExcel(
        'DomestiqHub_Buku_Besar_Semua_Akun',
        'Buku Besar',
        allAccountFlatLines.map((row) => ({
          Tanggal: row.entry.entryDate,
          NoJurnal: row.entry.entryNumber,
          KodeAkun: row.accountCode,
          NamaAkun: row.accountName,
          Keterangan: row.entry.description,
          Memo: row.memo || '-',
          DebitIDR: row.debitIdr,
          KreditIDR: row.creditIdr,
        }))
      );
      return;
    }

    exportTableToExcel(
      `Buku_Besar_${activeLedgerStatement.account.code}`,
      `Akun ${activeLedgerStatement.account.code}`,
      [
        {
          Tanggal: ledgerStartDate || '-',
          NoJurnal: 'SALDO-AWAL',
          Referensi: '-',
          Keterangan: `Saldo Awal ${activeLedgerStatement.account.code} — ${activeLedgerStatement.account.name}`,
          DebitIDR: 0,
          KreditIDR: 0,
          SaldoIDR: activeLedgerStatement.openingBalanceIdr,
        },
        ...filteredLedgerRows.map((r) => ({
          Tanggal: r.entryDate,
          NoJurnal: r.entryNumber,
          Referensi: r.referenceNumber || '-',
          Keterangan: r.memo ? `${r.description} (${r.memo})` : r.description,
          DebitIDR: r.debitIdr,
          KreditIDR: r.creditIdr,
          SaldoIDR: r.runningBalanceIdr,
        })),
      ]
    );
  };

  const handleExportBukuBesarPdf = () => {
    if (effectiveAccountId === 'ALL' || !activeLedgerStatement) {
      exportTableToPdf({
        filename: 'DomestiqHub_Buku_Besar_Semua_Akun',
        title: 'Buku Besar Umum (General Ledger) — Semua Akun',
        subtitle: `Periode: ${ledgerStartDate || 'Awal'} s/d ${ledgerEndDate || 'Sekarang'}`,
        headers: ['Tanggal', 'No. Jurnal', 'Kode', 'Akun', 'Keterangan', 'Debit (IDR)', 'Kredit (IDR)'],
        rows: allAccountFlatLines.map((r) => [
          r.entry.entryDate,
          r.entry.entryNumber,
          r.accountCode,
          r.accountName,
          r.entry.description,
          formatCurrency(r.debitIdr),
          formatCurrency(r.creditIdr),
        ]),
        company: state.settings,
      });
      return;
    }

    exportTableToPdf({
      filename: `Buku_Besar_${activeLedgerStatement.account.code}`,
      title: `Buku Besar Akun ${activeLedgerStatement.account.code} — ${activeLedgerStatement.account.name}`,
      subtitle: `Saldo Normal: ${activeLedgerStatement.account.normalBalance} | Saldo Akhir: ${formatCurrency(activeLedgerStatement.closingBalanceIdr)}`,
      headers: ['Tanggal', 'No. Jurnal', 'Ref', 'Keterangan', 'Debit (IDR)', 'Kredit (IDR)', 'Saldo Berjalan (IDR)'],
      rows: [
        [
          ledgerStartDate || '-',
          'SALDO AWAL',
          '-',
          'Saldo Awal Periode',
          '-',
          '-',
          formatCurrency(activeLedgerStatement.openingBalanceIdr),
        ],
        ...filteredLedgerRows.map((r) => [
          r.entryDate,
          r.entryNumber,
          r.referenceNumber || '-',
          r.memo ? `${r.description} — ${r.memo}` : r.description,
          r.debitIdr > 0 ? formatCurrency(r.debitIdr) : '-',
          r.creditIdr > 0 ? formatCurrency(r.creditIdr) : '-',
          formatCurrency(r.runningBalanceIdr),
        ]),
      ],
      company: state.settings,
    });
  };

  const handleExportBukuBesarCsv = () => {
    if (effectiveAccountId === 'ALL' || !activeLedgerStatement) {
      exportTableToCsv(
        'DomestiqHub_Buku_Besar_Semua_Akun',
        ['Tanggal', 'No Jurnal', 'Kode Akun', 'Nama Akun', 'Keterangan', 'Memo', 'Debit (IDR)', 'Kredit (IDR)'],
        allAccountFlatLines.map((row) => [
          row.entry.entryDate,
          row.entry.entryNumber,
          row.accountCode,
          row.accountName,
          row.entry.description,
          row.memo || '-',
          row.debitIdr,
          row.creditIdr,
        ])
      );
      return;
    }

    exportTableToCsv(
      `Buku_Besar_${activeLedgerStatement.account.code}`,
      ['Tanggal', 'No Jurnal', 'Referensi', 'Keterangan', 'Debit (IDR)', 'Kredit (IDR)', 'Saldo Berjalan (IDR)'],
      [
        [
          ledgerStartDate || '-',
          'SALDO-AWAL',
          '-',
          `Saldo Awal ${activeLedgerStatement.account.code} - ${activeLedgerStatement.account.name}`,
          0,
          0,
          activeLedgerStatement.openingBalanceIdr,
        ],
        ...filteredLedgerRows.map((r) => [
          r.entryDate,
          r.entryNumber,
          r.referenceNumber || '-',
          r.memo ? `${r.description} (${r.memo})` : r.description,
          r.debitIdr,
          r.creditIdr,
          r.runningBalanceIdr,
        ]),
      ]
    );
  };

  const handleExportTrialBalanceExcel = () => {
    exportTableToExcel(
      'DomestiqHub_Neraca_Saldo',
      'Neraca Saldo',
      trialBalance.rows.map((r) => ({
        Kode: r.account.code,
        NamaAkun: r.account.name,
        Kategori: r.account.category,
        SaldoAwal: r.openingBalanceIdr,
        MutasiDebit: r.periodDebitIdr,
        MutasiKredit: r.periodCreditIdr,
        SaldoAkhirDebit: r.endingDebitIdr,
        SaldoAkhirKredit: r.endingCreditIdr,
      }))
    );
  };

  const handleExportTrialBalanceCsv = () => {
    exportTableToCsv(
      'DomestiqHub_Neraca_Saldo',
      ['Kode', 'Nama Akun', 'Kategori', 'Saldo Awal', 'Mutasi Debit', 'Mutasi Kredit', 'Saldo Akhir Debit', 'Saldo Akhir Kredit'],
      [
        ...trialBalance.rows.map((r) => [
          r.account.code,
          r.account.name,
          r.account.category,
          r.openingBalanceIdr,
          r.periodDebitIdr,
          r.periodCreditIdr,
          r.endingDebitIdr,
          r.endingCreditIdr,
        ]),
        [
          'TOTAL',
          'TOTAL NERACA SALDO',
          '-',
          '-',
          trialBalance.totalPeriodDebitIdr,
          trialBalance.totalPeriodCreditIdr,
          trialBalance.totalEndingDebitIdr,
          trialBalance.totalEndingCreditIdr,
        ],
      ]
    );
  };

  const handleExportTrialBalancePdf = () => {
    exportTableToPdf({
      filename: 'DomestiqHub_Neraca_Saldo',
      title: 'Neraca Saldo (Trial Balance)',
      subtitle: `Periode: ${ledgerStartDate || 'Awal'} s/d ${ledgerEndDate || 'Sekarang'} | Status: ${
        trialBalance.isBalanced ? 'Seimbang (Balanced)' : 'Selisih Terdeteksi'
      }`,
      headers: ['Kode', 'Nama Akun', 'Kategori', 'Saldo Awal', 'Mutasi Debit', 'Mutasi Kredit', 'Akhir Debit', 'Akhir Kredit'],
      rows: [
        ...trialBalance.rows.map((r) => [
          r.account.code,
          r.account.name,
          r.account.category,
          formatCurrency(r.openingBalanceIdr),
          formatCurrency(r.periodDebitIdr),
          formatCurrency(r.periodCreditIdr),
          r.endingDebitIdr > 0 ? formatCurrency(r.endingDebitIdr) : '-',
          r.endingCreditIdr > 0 ? formatCurrency(r.endingCreditIdr) : '-',
        ]),
        [
          '',
          'TOTAL NERACA SALDO',
          '',
          '',
          formatCurrency(trialBalance.totalPeriodDebitIdr),
          formatCurrency(trialBalance.totalPeriodCreditIdr),
          formatCurrency(trialBalance.totalEndingDebitIdr),
          formatCurrency(trialBalance.totalEndingCreditIdr),
        ],
      ],
      company: state.settings,
      orientation: 'landscape',
    });
  };

  const incomePeriodLabel = `${ledgerStartDate || 'Awal'} s/d ${ledgerEndDate || 'Sekarang'}`;

  const handleExportIncomeStatementCsv = () => {
    exportTableToCsv(
      'DomestiqHub_Laporan_Laba_Rugi',
      ['Bagian', 'Kode Akun', 'Nama Pos / Akun', 'Nominal (IDR)'],
      [
        ...incomeStatement.revenues.map((r) => ['Pendapatan Usaha', r.code, r.name, r.amountIdr]),
        ['Subtotal', '', 'Total Pendapatan Usaha', incomeStatement.totalRevenueIdr],
        ...incomeStatement.cogs.map((r) => ['Harga Pokok Penjualan (HPP)', r.code, r.name, r.amountIdr]),
        ['Subtotal', '', 'Laba Kotor (Gross Profit)', incomeStatement.grossProfitIdr],
        ...incomeStatement.expenses.map((r) => ['Beban Operasional', r.code, r.name, r.amountIdr]),
        ['Subtotal', '', 'Total Beban Operasional', incomeStatement.totalExpensesIdr],
        ['Ringkasan', '', 'LABA BERSIH PERIODE BERJALAN', incomeStatement.netIncomeIdr],
      ]
    );
  };

  const handleExportIncomeStatementExcel = () => {
    exportTableToExcel('DomestiqHub_Laporan_Laba_Rugi', 'Laba Rugi', [
      ...incomeStatement.revenues.map((r) => ({
        Bagian: 'Pendapatan Usaha',
        KodeAkun: r.code,
        NamaAkun: r.name,
        NominalIDR: r.amountIdr,
      })),
      {
        Bagian: 'Subtotal',
        KodeAkun: '-',
        NamaAkun: 'Total Pendapatan Usaha',
        NominalIDR: incomeStatement.totalRevenueIdr,
      },
      ...incomeStatement.cogs.map((r) => ({
        Bagian: 'Harga Pokok Penjualan (HPP)',
        KodeAkun: r.code,
        NamaAkun: r.name,
        NominalIDR: r.amountIdr,
      })),
      {
        Bagian: 'Subtotal',
        KodeAkun: '-',
        NamaAkun: 'Laba Kotor (Gross Profit)',
        NominalIDR: incomeStatement.grossProfitIdr,
      },
      ...incomeStatement.expenses.map((r) => ({
        Bagian: 'Beban Operasional',
        KodeAkun: r.code,
        NamaAkun: r.name,
        NominalIDR: r.amountIdr,
      })),
      {
        Bagian: 'Subtotal',
        KodeAkun: '-',
        NamaAkun: 'Total Beban Operasional',
        NominalIDR: incomeStatement.totalExpensesIdr,
      },
      {
        Bagian: 'Ringkasan',
        KodeAkun: '-',
        NamaAkun: 'LABA BERSIH PERIODE BERJALAN',
        NominalIDR: incomeStatement.netIncomeIdr,
      },
    ]);
  };

  const handleExportIncomeStatementPdf = () => {
    exportIncomeStatementPdf(incomeStatement, state.settings, incomePeriodLabel);
  };

  const handleExportMonthlyCsv = () => {
    exportTableToCsv(
      'DomestiqHub_Performa_Bulanan',
      ['Bulan', 'Omzet (IDR)', 'HPP (IDR)', 'Laba Kotor (IDR)', 'Margin Kotor (%)', 'Beban OpEx (IDR)', 'Laba Bersih (IDR)', 'Jumlah PO', 'Nilai PO (IDR)', 'Jumlah SO', 'Nilai SO (IDR)'],
      [
        ...monthlyPerformance.months.map((m) => [
          m.monthLabel,
          m.revenueIdr,
          m.cogsIdr,
          m.grossProfitIdr,
          Number(m.grossMarginPercent.toFixed(1)),
          m.operatingExpensesIdr,
          m.netIncomeIdr,
          m.poCount,
          m.poTotalIdr,
          m.soCount,
          m.soTotalIdr,
        ]),
        [
          'TOTAL AKUMULASI',
          monthlyPerformance.totalRevenueIdr,
          monthlyPerformance.totalCogsIdr,
          monthlyPerformance.totalGrossProfitIdr,
          monthlyPerformance.totalRevenueIdr > 0
            ? Number(((monthlyPerformance.totalGrossProfitIdr / monthlyPerformance.totalRevenueIdr) * 100).toFixed(1))
            : 0,
          monthlyPerformance.totalOperatingExpensesIdr,
          monthlyPerformance.totalNetIncomeIdr,
          monthlyPerformance.months.reduce((s, m) => s + m.poCount, 0),
          monthlyPerformance.totalPoIdr,
          monthlyPerformance.months.reduce((s, m) => s + m.soCount, 0),
          monthlyPerformance.totalSoIdr,
        ],
      ]
    );
  };

  const handleExportMonthlyExcel = () => {
    exportTableToExcel(
      'DomestiqHub_Performa_Bulanan',
      'Performa Bulanan',
      monthlyPerformance.months.map((m) => ({
        Bulan: m.monthLabel,
        OmzetIDR: m.revenueIdr,
        HPPIDR: m.cogsIdr,
        LabaKotorIDR: m.grossProfitIdr,
        MarginKotorPersen: Number(m.grossMarginPercent.toFixed(1)),
        BebanOpExIDR: m.operatingExpensesIdr,
        LabaBersihIDR: m.netIncomeIdr,
        JumlahPO: m.poCount,
        NilaiPOIDR: m.poTotalIdr,
        JumlahSO: m.soCount,
        NilaiSOIDR: m.soTotalIdr,
      }))
    );
  };

  const handleExportMonthlyPdf = () => {
    exportMonthlyPerformancePdf(monthlyPerformance, state.settings);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg sm:text-xl font-bold text-[#0B1B3A]">
            {tr('Accounting & Buku Besar (General Ledger)', 'Accounting & General Ledger')}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            {tr(
              'Pembukuan double-entry otomatis, buku besar per akun, jurnal umum, neraca saldo, laporan keuangan & hutang-piutang.',
              'Automated double-entry bookkeeping, account ledger, general journal, trial balance, financial statements & AP/AR.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden sm:inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 font-mono tabular-nums">
            {tr('Kurs', 'FX')}: 1 USD = {formatCurrency(rate, 'IDR')}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Export Buku Besar CSV"
            onClick={handleExportBukuBesarCsv}
          >
            <Download className="h-3.5 w-3.5 text-slate-700" />
            Export CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Export Buku Besar Excel"
            onClick={handleExportBukuBesarExcel}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Export Buku Besar PDF"
            onClick={handleExportBukuBesarPdf}
          >
            <FileText className="h-3.5 w-3.5 text-[#1B5E99]" />
            Export PDF
          </Button>
          {canWrite && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={openCreateJournalModal}
              className="w-full sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              {tr('Buat Jurnal Umum', 'Create Journal Entry')}
            </Button>
          )}
        </div>
      </div>

      {/* KPI Strip (2x2 on mobile, 4-col on desktop) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] sm:text-xs font-medium text-slate-600">
                {tr('Kas & Bank', 'Cash & Bank')}
              </span>
              <Landmark className="h-4 w-4 text-[#1B5E99] shrink-0" />
            </div>
            <div className="mt-1.5 text-sm sm:text-xl font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
              {formatCompactIdr(totalCashBankIdr, lang)}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 truncate">
              {tr('Akun', 'Accounts')}{' '}
              {cashBankAccounts.length > 0
                ? cashBankAccounts.map((a) => a.code).join(', ')
                : '-'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] sm:text-xs font-medium text-slate-600">
                {tr('Piutang (AR)', 'Receivables (AR)')}
              </span>
              <BookOpen className="h-4 w-4 text-[#1B5E99] shrink-0" />
            </div>
            <div className="mt-1.5 text-sm sm:text-xl font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
              {formatCompactIdr(totalArIdr, lang)}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 truncate">
              {state.invoices.filter((i) => i.ledgerType === 'AR' && i.balanceDue > 0).length}{' '}
              {tr('invoice berjalan', 'open invoices')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] sm:text-xs font-medium text-slate-600">
                {tr('Hutang (AP)', 'Payables (AP)')}
              </span>
              <CreditCard className="h-4 w-4 text-[#B88918] shrink-0" />
            </div>
            <div className="mt-1.5 text-sm sm:text-xl font-bold text-[#0B1B3A] font-mono tabular-nums truncate">
              {formatCompactIdr(totalApIdr, lang)}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 truncate">
              {state.invoices.filter((i) => i.ledgerType === 'AP' && i.balanceDue > 0).length}{' '}
              {tr('tagihan terbuka', 'open bills')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] sm:text-xs font-medium text-slate-600">
                {tr('Laba Bersih', 'Net Income')}
              </span>
              <Scale className="h-4 w-4 text-emerald-700 shrink-0" />
            </div>
            <div
              className={`mt-1.5 text-sm sm:text-xl font-bold font-mono tabular-nums truncate ${
                allTimeIncomeStatement.netIncomeIdr >= 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {formatCompactIdr(allTimeIncomeStatement.netIncomeIdr, lang)}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 truncate">
              {tr('Omzet', 'Revenue')} {formatCompactIdr(allTimeIncomeStatement.totalRevenueIdr, lang)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Navigation Tabs (Horizontally scrollable on mobile) */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="ledger">{tr('Buku Besar', 'General Ledger')}</TabsTrigger>
          <TabsTrigger value="journals">
            {tr('Jurnal Umum', 'Journal Entries')} ({state.journalEntries.length})
          </TabsTrigger>
          <TabsTrigger value="statements">{tr('Neraca & Laporan', 'Financial Statements')}</TabsTrigger>
          <TabsTrigger value="coa">{tr('Daftar Akun', 'Chart of Accounts')} ({sortedAccounts.length})</TabsTrigger>
          <TabsTrigger value="invoices">{tr('Hutang & Piutang', 'AP & AR')} ({state.invoices.length})</TabsTrigger>
          <TabsTrigger value="aging">{tr('Aging Report', 'Aging Report')}</TabsTrigger>
          <TabsTrigger value="closing">{tr('Tutup Buku & Budget', 'Period Close & Budget')}</TabsTrigger>
        </TabsList>

        {/* =============================================================== */}
        {/* TAB 1: BUKU BESAR (GENERAL LEDGER)                              */}
        {/* =============================================================== */}
        <TabsContent value="ledger" className="space-y-4">
          <Card>
            <CardContent className="p-3.5 sm:p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-2 lg:col-span-5 space-y-1">
                  <Label htmlFor="gl-account-select">Pilih Akun Buku Besar</Label>
                  <NativeSelect
                    id="gl-account-select"
                    value={effectiveAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                  >
                    <option value="ALL">Semua Akun — Mutasi Kronologis</option>
                    {sortedAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} — {acc.name} ({acc.category})
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="lg:col-span-2 space-y-1">
                  <Label htmlFor="gl-start">Dari Tanggal</Label>
                  <Input
                    id="gl-start"
                    type="date"
                    value={ledgerStartDate}
                    onChange={(e) => setLedgerStartDate(e.target.value)}
                  />
                </div>
                <div className="lg:col-span-2 space-y-1">
                  <Label htmlFor="gl-end">Sampai Tanggal</Label>
                  <Input
                    id="gl-end"
                    type="date"
                    value={ledgerEndDate}
                    onChange={(e) => setLedgerEndDate(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                    <Input
                      aria-label="Cari transaksi buku besar"
                      className="pl-9"
                      placeholder="Cari jurnal / ket..."
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                    />
                  </div>
                  {(ledgerStartDate || ledgerEndDate || ledgerSearch) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Reset filter periode"
                      onClick={() => {
                        setLedgerStartDate('');
                        setLedgerEndDate('');
                        setLedgerSearch('');
                      }}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {effectiveAccountId !== 'ALL' && activeLedgerStatement ? (
            <>
              {/* Account Header & 4 Balance Boxes */}
              <Card>
                <CardContent className="p-3.5 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="rounded-md bg-[#0B1B3A] px-2.5 py-1 text-xs font-mono font-bold text-[#D9AA32] shrink-0">
                        {activeLedgerStatement.account.code}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#0B1B3A] truncate">
                          {activeLedgerStatement.account.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {activeLedgerStatement.account.category} · Saldo Normal:{' '}
                          {activeLedgerStatement.account.normalBalance}
                        </div>
                      </div>
                    </div>
                    <StatusLabel
                      status={activeLedgerStatement.account.category}
                      tone={getCategoryTone(activeLedgerStatement.account.category)}
                    />
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 text-xs">
                    <div className="rounded-lg bg-[#F4F7FB] border border-slate-200/80 p-3">
                      <div className="text-slate-500 text-[11px]">Saldo Awal</div>
                      <div className="mt-1 text-xs sm:text-sm font-bold font-mono tabular-nums text-[#0B1B3A]">
                        {formatCurrency(activeLedgerStatement.openingBalanceIdr)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#EBF3FA]/60 border border-[#BFD9EF] p-3">
                      <div className="text-[#154C7E] text-[11px]">Total Debit</div>
                      <div className="mt-1 text-xs sm:text-sm font-bold font-mono tabular-nums text-[#154C7E]">
                        {formatCurrency(activeLedgerStatement.totalDebitIdr)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#FDF7E3]/70 border border-[#EED58B] p-3">
                      <div className="text-[#8F670D] text-[11px]">Total Kredit</div>
                      <div className="mt-1 text-xs sm:text-sm font-bold font-mono tabular-nums text-[#8F670D]">
                        {formatCurrency(activeLedgerStatement.totalCreditIdr)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#0B1B3A] p-3 text-white">
                      <div className="text-slate-300 text-[11px]">Saldo Akhir</div>
                      <div className="mt-1 text-xs sm:text-sm font-bold font-mono tabular-nums text-[#D9AA32]">
                        {formatCurrency(activeLedgerStatement.closingBalanceIdr)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Mobile Ledger Card List */}
              <div className="space-y-2.5 md:hidden">
                <Card>
                  <CardContent className="p-3.5 flex items-center justify-between text-xs bg-slate-50/70">
                    <div>
                      <div className="font-mono font-semibold text-[#0B1B3A]">SALDO AWAL</div>
                      <div className="text-slate-500">{ledgerStartDate || 'Awal periode'}</div>
                    </div>
                    <div className="text-right font-mono tabular-nums font-bold text-[#0B1B3A]">
                      {formatCurrency(activeLedgerStatement.openingBalanceIdr)}
                    </div>
                  </CardContent>
                </Card>

                {filteredLedgerRows.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-xs text-slate-500">
                      Belum ada mutasi transaksi untuk akun ini pada periode yang dipilih.
                    </CardContent>
                  </Card>
                ) : (
                  filteredLedgerRows.map((row, idx) => {
                    const parentJournal = state.journalEntries.find((j) => j.id === row.entryId);
                    return (
                      <Card key={`m_${row.entryId}_${idx}`}>
                        <CardContent className="p-3.5 space-y-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => parentJournal && setViewJournal(parentJournal)}
                                className="font-mono font-bold text-[#1B5E99] hover:underline cursor-pointer"
                              >
                                {row.entryNumber}
                              </button>
                              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                {row.entryDate} · {row.journalType}
                                {row.referenceNumber ? ` · ${row.referenceNumber}` : ''}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] text-slate-400">Saldo</div>
                              <div className="font-mono tabular-nums font-bold text-[#0B1B3A]">
                                {formatCurrency(row.runningBalanceIdr)}
                              </div>
                            </div>
                          </div>
                          <div className="font-medium text-[#0B1B3A]">{row.description}</div>
                          {row.memo && <div className="text-[11px] text-slate-500">{row.memo}</div>}
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Debit</span>
                              <span className="font-mono tabular-nums font-semibold text-[#154C7E]">
                                {row.debitIdr > 0 ? formatCurrency(row.debitIdr) : '-'}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-slate-500 block">Kredit</span>
                              <span className="font-mono tabular-nums font-semibold text-[#8F670D]">
                                {row.creditIdr > 0 ? formatCurrency(row.creditIdr) : '-'}
                              </span>
                            </div>
                          </div>
                          {isDirektur && (
                            <div className="flex justify-end pt-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:bg-red-50 px-2"
                                aria-label={`Hapus jurnal ${row.entryNumber}`}
                                onClick={() =>
                                  setConfirmDialog({
                                    title: `Hapus Permanen ${row.entryNumber}?`,
                                    description:
                                      'Dokumen jurnal beserta seluruh baris mutasinya akan dihapus permanen dari Buku Besar.',
                                    confirmLabel: 'Hapus Permanen',
                                    tone: 'danger',
                                    onConfirm: async () => {
                                      await erp.deleteJournalEntry(row.entryId);
                                    },
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Hapus Jurnal
                              </Button>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>

              {/* Desktop Specific Account Running Ledger Table */}
              <Card className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Tanggal</th>
                        <th className="py-3 px-3 font-semibold">No. Jurnal</th>
                        <th className="py-3 px-3 font-semibold">Jenis</th>
                        <th className="py-3 px-3 font-semibold">Referensi</th>
                        <th className="py-3 px-3 font-semibold">Keterangan &amp; Memo</th>
                        <th className="py-3 px-3 font-semibold text-right">Debit (IDR)</th>
                        <th className="py-3 px-3 font-semibold text-right">Kredit (IDR)</th>
                        <th className="py-3 px-4 font-semibold text-right">Saldo Berjalan</th>
                        {isDirektur && <th className="py-3 px-3 font-semibold text-right">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr className="bg-slate-50/70 font-medium text-slate-600">
                        <td className="py-2.5 px-4 font-mono tabular-nums">
                          {ledgerStartDate || '-'}
                        </td>
                        <td className="py-2.5 px-3 font-mono">SALDO AWAL</td>
                        <td className="py-2.5 px-3">-</td>
                        <td className="py-2.5 px-3 font-mono">-</td>
                        <td className="py-2.5 px-3">Saldo Awal Periode Akun {activeLedgerStatement.account.code}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">-</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">-</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-[#0B1B3A]">
                          {formatCurrency(activeLedgerStatement.openingBalanceIdr)}
                        </td>
                        {isDirektur && <td className="py-2.5 px-3" />}
                      </tr>

                      {filteredLedgerRows.length === 0 ? (
                        <tr>
                          <td colSpan={isDirektur ? 9 : 8} className="py-10 text-center text-slate-500">
                            Belum ada mutasi transaksi untuk akun ini pada periode yang dipilih.
                          </td>
                        </tr>
                      ) : (
                        filteredLedgerRows.map((row, idx) => {
                          const parentJournal = state.journalEntries.find((j) => j.id === row.entryId);
                          return (
                            <tr key={`${row.entryId}_${idx}`} className="hover:bg-[#F4F7FB]">
                              <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                {row.entryDate}
                              </td>
                              <td className="py-3 px-3 font-mono whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => parentJournal && setViewJournal(parentJournal)}
                                  className="font-semibold text-[#1B5E99] hover:underline cursor-pointer"
                                >
                                  {row.entryNumber}
                                </button>
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                <StatusLabel status={row.journalType} tone="info" />
                              </td>
                              <td className="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">
                                {row.referenceNumber || '-'}
                              </td>
                              <td className="py-3 px-3 max-w-sm">
                                <div className="font-medium text-[#0B1B3A]">{row.description}</div>
                                {row.memo && <div className="text-[11px] text-slate-500">{row.memo}</div>}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums font-medium text-[#154C7E]">
                                {row.debitIdr > 0 ? formatCurrency(row.debitIdr) : '-'}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums font-medium text-[#8F670D]">
                                {row.creditIdr > 0 ? formatCurrency(row.creditIdr) : '-'}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-[#0B1B3A]">
                                {formatCurrency(row.runningBalanceIdr)}
                              </td>
                              {isDirektur && (
                                <td className="py-3 px-3 text-right whitespace-nowrap">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Hapus jurnal ${row.entryNumber}`}
                                    title="Hapus permanen jurnal"
                                    className="text-red-600 hover:bg-red-50"
                                    onClick={() =>
                                      setConfirmDialog({
                                        title: `Hapus Permanen ${row.entryNumber}?`,
                                        description:
                                          'Dokumen jurnal beserta seluruh baris mutasinya akan dihapus permanen dari Buku Besar.',
                                        confirmLabel: 'Hapus Permanen',
                                        tone: 'danger',
                                        onConfirm: async () => {
                                          await erp.deleteJournalEntry(row.entryId);
                                        },
                                      })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot className="bg-slate-100/90 border-t-2 border-slate-200 font-semibold text-[#0B1B3A]">
                      <tr>
                        <td colSpan={5} className="py-3 px-4 text-right">
                          Total Mutasi &amp; Saldo Akhir ({activeLedgerStatement.account.code})
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#154C7E]">
                          {formatCurrency(activeLedgerStatement.totalDebitIdr)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#8F670D]">
                          {formatCurrency(activeLedgerStatement.totalCreditIdr)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold">
                          {formatCurrency(activeLedgerStatement.closingBalanceIdr)}
                        </td>
                        {isDirektur && <td className="py-3 px-3" />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            </>
          ) : (
            /* ALL ACCOUNTS CHRONOLOGICAL GENERAL LEDGER VIEW */
            <>
              <div className="space-y-2.5 md:hidden">
                {allAccountFlatLines.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-xs text-slate-500">
                      Tidak ada baris mutasi jurnal yang cocok.
                    </CardContent>
                  </Card>
                ) : (
                  allAccountFlatLines.map((item, idx) => (
                    <Card key={`m_all_${item.entry.id}_${idx}`}>
                      <CardContent className="p-3.5 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setViewJournal(item.entry)}
                            className="font-mono font-bold text-[#1B5E99] hover:underline cursor-pointer"
                          >
                            {item.entry.entryNumber}
                          </button>
                          <span className="font-mono tabular-nums text-slate-500">
                            {item.entry.entryDate}
                          </span>
                        </div>
                        <div className="font-semibold text-[#0B1B3A]">
                          <span className="font-mono text-[#1B5E99] mr-1.5">{item.accountCode}</span>
                          {item.accountName}
                        </div>
                        <div className="text-slate-600">{item.entry.description}</div>
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                          <div>
                            <span className="text-[10px] text-slate-500 block">Debit</span>
                            <span className="font-mono tabular-nums font-semibold text-[#154C7E]">
                              {item.debitIdr > 0 ? formatCurrency(item.debitIdr) : '-'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 block">Kredit</span>
                            <span className="font-mono tabular-nums font-semibold text-[#8F670D]">
                              {item.creditIdr > 0 ? formatCurrency(item.creditIdr) : '-'}
                            </span>
                          </div>
                        </div>
                        {isDirektur && (
                          <div className="flex justify-end pt-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:bg-red-50 px-2"
                              aria-label={`Hapus jurnal ${item.entry.entryNumber}`}
                              onClick={() =>
                                setConfirmDialog({
                                  title: `Hapus Permanen ${item.entry.entryNumber}?`,
                                  description:
                                    'Dokumen jurnal beserta seluruh baris mutasinya akan dihapus permanen dari Buku Besar.',
                                  confirmLabel: 'Hapus Permanen',
                                  tone: 'danger',
                                  onConfirm: async () => {
                                    await erp.deleteJournalEntry(item.entry.id);
                                  },
                                })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Hapus Jurnal
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>

              <Card className="hidden md:block">
                <CardHeader>
                  <CardTitle>Buku Besar Umum — Seluruh Mutasi Akun</CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Tanggal</th>
                        <th className="py-3 px-3 font-semibold">No. Jurnal</th>
                        <th className="py-3 px-3 font-semibold">Akun</th>
                        <th className="py-3 px-3 font-semibold">Keterangan</th>
                        <th className="py-3 px-3 font-semibold text-right">Debit (IDR)</th>
                        <th className="py-3 px-4 font-semibold text-right">Kredit (IDR)</th>
                        {isDirektur && <th className="py-3 px-3 font-semibold text-right">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allAccountFlatLines.length === 0 ? (
                        <tr>
                          <td colSpan={isDirektur ? 7 : 6} className="py-10 text-center text-slate-500">
                            Tidak ada baris mutasi jurnal yang cocok.
                          </td>
                        </tr>
                      ) : (
                        allAccountFlatLines.map((item, idx) => (
                          <tr key={`${item.entry.id}_${idx}`} className="hover:bg-[#F4F7FB]">
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                              {item.entry.entryDate}
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              <button
                                type="button"
                                onClick={() => setViewJournal(item.entry)}
                                className="font-semibold text-[#1B5E99] hover:underline cursor-pointer"
                              >
                                {item.entry.entryNumber}
                              </button>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-mono font-semibold text-[#0B1B3A] mr-1.5">
                                {item.accountCode}
                              </span>
                              <span className="text-slate-700">{item.accountName}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="text-[#0B1B3A]">{item.entry.description}</div>
                              {item.memo && <div className="text-[11px] text-slate-500">{item.memo}</div>}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#154C7E]">
                              {item.debitIdr > 0 ? formatCurrency(item.debitIdr) : '-'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#8F670D]">
                              {item.creditIdr > 0 ? formatCurrency(item.creditIdr) : '-'}
                            </td>
                            {isDirektur && (
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Hapus jurnal ${item.entry.entryNumber}`}
                                  title="Hapus permanen jurnal"
                                  className="text-red-600 hover:bg-red-50"
                                  onClick={() =>
                                    setConfirmDialog({
                                      title: `Hapus Permanen ${item.entry.entryNumber}?`,
                                      description:
                                        'Dokumen jurnal beserta seluruh baris mutasinya akan dihapus permanen dari Buku Besar.',
                                      confirmLabel: 'Hapus Permanen',
                                      tone: 'danger',
                                      onConfirm: async () => {
                                        await erp.deleteJournalEntry(item.entry.id);
                                      },
                                    })
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className="bg-slate-100/90 border-t-2 border-slate-200 font-semibold text-[#0B1B3A]">
                      <tr>
                        <td colSpan={4} className="py-3 px-4 text-right">
                          Total Mutasi Periode
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#154C7E]">
                          {formatCurrency(allAccountFlatLines.reduce((s, r) => s + r.debitIdr, 0))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#8F670D]">
                          {formatCurrency(allAccountFlatLines.reduce((s, r) => s + r.creditIdr, 0))}
                        </td>
                        {isDirektur && <td className="py-3 px-3" />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 2: JURNAL UMUM (GENERAL JOURNAL)                            */}
        {/* =============================================================== */}
        <TabsContent value="journals" className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
              <div className="relative">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                <Input
                  aria-label="Cari jurnal umum"
                  className="pl-9"
                  placeholder="Cari no. jurnal, ref, ket..."
                  value={journalSearch}
                  onChange={(e) => setJournalSearch(e.target.value)}
                />
              </div>
              <NativeSelect
                aria-label="Filter tipe jurnal"
                value={journalTypeFilter}
                onChange={(e) => setJournalTypeFilter(e.target.value)}
              >
                <option value="ALL">Semua Tipe Jurnal</option>
                <option value="Jurnal Umum">Jurnal Umum</option>
                <option value="Pembelian (AP)">Pembelian (AP)</option>
                <option value="Penjualan (AR)">Penjualan (AR)</option>
                <option value="Kas & Bank">Kas &amp; Bank</option>
                <option value="Penyesuaian">Penyesuaian</option>
              </NativeSelect>
              <NativeSelect
                aria-label="Filter status jurnal"
                value={journalStatusFilter}
                onChange={(e) => setJournalStatusFilter(e.target.value)}
              >
                <option value="ALL">Semua Status</option>
                <option value="Posted">Posted</option>
                <option value="Void">Void</option>
              </NativeSelect>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isDirektur && dummyJournalCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-red-700 border-red-200 hover:bg-red-50 flex-1 sm:flex-none"
                  onClick={() =>
                    setConfirmDialog({
                      title: 'Hapus Semua Jurnal Dummy Bawaan?',
                      description: `Sebanyak ${dummyJournalCount} jurnal bawaan sistem akan dihapus permanen agar Anda dapat memulai pembukuan perusahaan dari awal.`,
                      confirmLabel: `Hapus ${dummyJournalCount} Jurnal Dummy`,
                      tone: 'danger',
                      onConfirm: async () => {
                        await erp.clearDummyJournalEntries();
                      },
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Hapus Dummy ({dummyJournalCount})
                </Button>
              )}
              {canWrite && (
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={openCreateJournalModal}
                  className="flex-1 sm:flex-none"
                >
                  <Plus className="h-4 w-4" />
                  Buat Jurnal Umum
                </Button>
              )}
            </div>
          </div>

          {/* Mobile Journal Cards */}
          <div className="space-y-3 md:hidden">
            {filteredJournals.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada dokumen jurnal pada filter saat ini.
                </CardContent>
              </Card>
            ) : (
              filteredJournals.map((jrn) => (
                <Card key={`m_jrn_${jrn.id}`} className={jrn.status === 'Void' ? 'opacity-65' : ''}>
                  <CardContent className="p-4 space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-[#0B1B3A] text-sm">
                          {jrn.entryNumber}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          {jrn.entryDate}
                          {jrn.referenceNumber ? ` · ${jrn.referenceNumber}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusLabel status={jrn.journalType} tone="info" />
                        <StatusLabel
                          status={jrn.status}
                          tone={jrn.status === 'Posted' ? 'success' : 'danger'}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="font-semibold text-[#0B1B3A]">{jrn.description}</div>
                      <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                        {jrn.lines.map((l) => `${l.accountCode} ${l.accountName}`).join(' · ')}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Total Debit</span>
                        <span className="font-mono tabular-nums font-bold text-[#154C7E]">
                          {formatCurrency(jrn.totalDebitIdr)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Total Kredit</span>
                        <span className="font-mono tabular-nums font-bold text-[#8F670D]">
                          {formatCurrency(jrn.totalCreditIdr)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setViewJournal(jrn)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Lihat Voucher
                      </Button>
                      {canWrite && jrn.status === 'Posted' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-amber-700 border-amber-200 hover:bg-amber-50"
                          onClick={() =>
                            setConfirmDialog({
                              title: `Void Jurnal ${jrn.entryNumber}?`,
                              description:
                                'Status jurnal akan diubah menjadi Void sehingga tidak lagi dihitung di Buku Besar, Neraca Saldo, dan Laporan Keuangan.',
                              confirmLabel: 'Ya, Void Jurnal',
                              tone: 'warning',
                              onConfirm: async () => {
                                await erp.voidJournalEntry(jrn.id);
                              },
                            })
                          }
                        >
                          Void
                        </Button>
                      )}
                      {isDirektur && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Hapus permanen ${jrn.entryNumber}`}
                          className="text-red-600 hover:bg-red-50"
                          onClick={() =>
                            setConfirmDialog({
                              title: `Hapus Permanen ${jrn.entryNumber}?`,
                              description:
                                'Dokumen jurnal ini akan dihapus permanen dari database dan tidak dapat dikembalikan.',
                              confirmLabel: 'Hapus Permanen',
                              tone: 'danger',
                              onConfirm: async () => {
                                await erp.deleteJournalEntry(jrn.id);
                              },
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Desktop Journal Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-3 font-semibold">Tanggal</th>
                    <th className="py-3 px-2.5 font-semibold">No. Jurnal / Ref</th>
                    <th className="py-3 px-2.5 font-semibold">Tipe</th>
                    <th className="py-3 px-2.5 font-semibold">Keterangan &amp; Akun</th>
                    <th className="py-3 px-2.5 font-semibold text-right">Debit (IDR)</th>
                    <th className="py-3 px-2.5 font-semibold text-right">Kredit (IDR)</th>
                    <th className="py-3 px-2.5 font-semibold">Status</th>
                    <th className="py-3 px-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredJournals.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        Belum ada dokumen jurnal pada filter saat ini.
                      </td>
                    </tr>
                  ) : (
                    filteredJournals.map((jrn) => (
                      <tr
                        key={jrn.id}
                        className={`hover:bg-[#F4F7FB] ${jrn.status === 'Void' ? 'opacity-60' : ''}`}
                      >
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {jrn.entryDate}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <div className="font-mono font-semibold text-[#0B1B3A]">
                            {jrn.entryNumber}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {jrn.referenceNumber || '-'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <StatusLabel status={jrn.journalType} tone="info" />
                        </td>
                        <td className="py-2.5 px-2.5 max-w-[230px]">
                          <div className="font-medium text-[#0B1B3A] line-clamp-2">
                            {jrn.description}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {jrn.lines.map((l) => `${l.accountCode} ${l.accountName}`).join(' · ')}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-medium text-[#154C7E] whitespace-nowrap">
                          {formatCurrency(jrn.totalDebitIdr)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-medium text-[#8F670D] whitespace-nowrap">
                          {formatCurrency(jrn.totalCreditIdr)}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <StatusLabel
                            status={jrn.status}
                            tone={jrn.status === 'Posted' ? 'success' : 'danger'}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="px-2"
                              onClick={() => setViewJournal(jrn)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Voucher
                            </Button>
                            {canWrite && jrn.status === 'Posted' && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-amber-700 border-amber-200 hover:bg-amber-50"
                                onClick={() =>
                                  setConfirmDialog({
                                    title: `Void Jurnal ${jrn.entryNumber}?`,
                                    description:
                                      'Status jurnal akan diubah menjadi Void sehingga tidak lagi dihitung di Buku Besar, Neraca Saldo, dan Laporan Keuangan.',
                                    confirmLabel: 'Ya, Void Jurnal',
                                    tone: 'warning',
                                    onConfirm: async () => {
                                      await erp.voidJournalEntry(jrn.id);
                                    },
                                  })
                                }
                              >
                                Void
                              </Button>
                            )}
                            {isDirektur && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                title="Hapus permanen jurnal"
                                className="text-red-600 hover:bg-red-50"
                                onClick={() =>
                                  setConfirmDialog({
                                    title: `Hapus Permanen ${jrn.entryNumber}?`,
                                    description:
                                      'Dokumen jurnal ini akan dihapus permanen dari database dan tidak dapat dikembalikan.',
                                    confirmLabel: 'Hapus Permanen',
                                    tone: 'danger',
                                    onConfirm: async () => {
                                      await erp.deleteJournalEntry(jrn.id);
                                    },
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 3: NERACA SALDO & LAPORAN KEUANGAN                          */}
        {/* =============================================================== */}
        <TabsContent value="statements" className="space-y-5">
          {/* Trial Balance Card */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Neraca Saldo (Trial Balance)</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verifikasi keseimbangan total saldo akhir Debit dan Kredit seluruh akun aktif.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {trialBalance.isBalanced ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Seimbang (Balanced)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-800">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Selisih Terdeteksi
                  </span>
                )}
                <Button type="button" variant="outline" size="sm" onClick={handleExportTrialBalanceCsv}>
                  <Download className="h-3.5 w-3.5 text-slate-700" />
                  CSV
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleExportTrialBalanceExcel}>
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                  Excel
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleExportTrialBalancePdf}>
                  <FileText className="h-3.5 w-3.5 text-[#1B5E99]" />
                  PDF
                </Button>
              </div>
            </CardHeader>

            {/* Mobile Trial Balance Cards */}
            <div className="divide-y divide-slate-100 md:hidden">
              {trialBalance.rows.map((r) => (
                <div key={`m_tb_${r.account.id}`} className="p-3.5 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAccountId(r.account.id);
                        setActiveTab('ledger');
                      }}
                      className="text-left font-semibold text-[#0B1B3A] cursor-pointer"
                    >
                      <span className="font-mono text-[#1B5E99] mr-1.5">{r.account.code}</span>
                      {r.account.name}
                    </button>
                    <StatusLabel
                      status={r.account.category}
                      tone={getCategoryTone(r.account.category)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Saldo Akhir Debit</span>
                      <span className="font-mono tabular-nums font-semibold text-[#154C7E]">
                        {r.endingDebitIdr > 0 ? formatCurrency(r.endingDebitIdr) : '-'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">Saldo Akhir Kredit</span>
                      <span className="font-mono tabular-nums font-semibold text-[#8F670D]">
                        {r.endingCreditIdr > 0 ? formatCurrency(r.endingCreditIdr) : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="p-3.5 bg-[#0B1B3A] text-white grid grid-cols-2 gap-2 text-xs font-semibold">
                <div>
                  <span className="text-[10px] text-slate-300 block">Total Akhir Debit</span>
                  <span className="font-mono tabular-nums text-[#D9AA32]">
                    {formatCurrency(trialBalance.totalEndingDebitIdr)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-300 block">Total Akhir Kredit</span>
                  <span className="font-mono tabular-nums text-[#D9AA32]">
                    {formatCurrency(trialBalance.totalEndingCreditIdr)}
                  </span>
                </div>
              </div>
            </div>

            {/* Desktop Trial Balance Table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Kode</th>
                    <th className="py-3 px-3 font-semibold">Nama Akun</th>
                    <th className="py-3 px-3 font-semibold">Kategori</th>
                    <th className="py-3 px-3 font-semibold text-right">Saldo Awal</th>
                    <th className="py-3 px-3 font-semibold text-right">Mutasi Debit</th>
                    <th className="py-3 px-3 font-semibold text-right">Mutasi Kredit</th>
                    <th className="py-3 px-3 font-semibold text-right">Saldo Akhir Debit</th>
                    <th className="py-3 px-4 font-semibold text-right">Saldo Akhir Kredit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trialBalance.rows.map((r) => (
                    <tr key={r.account.id} className="hover:bg-[#F4F7FB]">
                      <td className="py-2.5 px-4 font-mono font-semibold text-[#0B1B3A]">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAccountId(r.account.id);
                            setActiveTab('ledger');
                          }}
                          className="text-[#1B5E99] hover:underline cursor-pointer"
                          title="Buka Buku Besar akun ini"
                        >
                          {r.account.code}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-[#0B1B3A]">{r.account.name}</td>
                      <td className="py-2.5 px-3">
                        <StatusLabel
                          status={r.account.category}
                          tone={getCategoryTone(r.account.category)}
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        {formatCurrency(r.openingBalanceIdr)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#154C7E]">
                        {formatCurrency(r.periodDebitIdr)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8F670D]">
                        {formatCurrency(r.periodCreditIdr)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#0B1B3A]">
                        {r.endingDebitIdr > 0 ? formatCurrency(r.endingDebitIdr) : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-[#0B1B3A]">
                        {r.endingCreditIdr > 0 ? formatCurrency(r.endingCreditIdr) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#0B1B3A] text-white font-semibold">
                  <tr>
                    <td colSpan={4} className="py-3 px-4 text-right">
                      TOTAL NERACA SALDO
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(trialBalance.totalPeriodDebitIdr)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(trialBalance.totalPeriodCreditIdr)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#D9AA32]">
                      {formatCurrency(trialBalance.totalEndingDebitIdr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-[#D9AA32]">
                      {formatCurrency(trialBalance.totalEndingCreditIdr)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Income Statement & Balance Sheet Side-by-Side */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {/* Laba Rugi (Income Statement) */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
                <CardTitle>Laporan Laba Rugi (Income Statement)</CardTitle>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleExportIncomeStatementCsv}
                    aria-label="Export Laba Rugi CSV"
                  >
                    <Download className="h-3.5 w-3.5 text-slate-700" />
                    CSV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleExportIncomeStatementExcel}
                    aria-label="Export Laba Rugi Excel"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                    Excel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleExportIncomeStatementPdf}
                    aria-label="Export Laba Rugi PDF"
                  >
                    <FileText className="h-3.5 w-3.5 text-[#1B5E99]" />
                    PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div>
                  <div className="font-semibold text-[#154C7E] mb-1.5">
                    Pendapatan Usaha
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {incomeStatement.revenues.map((item) => (
                      <div key={item.accountId} className="flex justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-slate-500 mr-2">{item.code}</span>
                          {item.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold shrink-0">
                          {formatCurrency(item.amountIdr)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2 px-3 py-2 bg-slate-50 font-semibold">
                      <span>Total Pendapatan</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(incomeStatement.totalRevenueIdr)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-semibold text-[#8F670D] mb-1.5">
                    Harga Pokok Penjualan (HPP)
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {incomeStatement.cogs.map((item) => (
                      <div key={item.accountId} className="flex justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-slate-500 mr-2">{item.code}</span>
                          {item.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold shrink-0">
                          {formatCurrency(item.amountIdr)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2 px-3 py-2 bg-[#EBF3FA]/60 font-bold text-[#0B1B3A]">
                      <span>Laba Kotor (Gross Profit)</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(incomeStatement.grossProfitIdr)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-semibold text-red-700 mb-1.5">
                    Beban Operasional
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {incomeStatement.expenses.map((item) => (
                      <div key={item.accountId} className="flex justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-slate-500 mr-2">{item.code}</span>
                          {item.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold shrink-0">
                          {formatCurrency(item.amountIdr)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2 px-3 py-2 bg-slate-50 font-semibold">
                      <span>Total Beban Operasional</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(incomeStatement.totalExpensesIdr)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0B1B3A] px-4 py-3 text-white">
                  <span className="text-xs sm:text-sm font-semibold">Laba Bersih Periode Berjalan</span>
                  <span className="text-sm sm:text-base font-bold font-mono tabular-nums text-[#D9AA32] shrink-0">
                    {formatCurrency(incomeStatement.netIncomeIdr)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Neraca (Balance Sheet) */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
                <CardTitle>Neraca / Posisi Keuangan (Balance Sheet)</CardTitle>
                <StatusLabel
                  status={balanceSheet.isBalanced ? 'Aset = Kewajiban + Ekuitas' : 'Tidak Seimbang'}
                  tone={balanceSheet.isBalanced ? 'success' : 'danger'}
                />
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div>
                  <div className="font-semibold text-[#154C7E] mb-1.5">
                    Aset (Assets)
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {balanceSheet.assets.map((item) => (
                      <div key={item.accountId} className="flex justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-slate-500 mr-2">{item.code}</span>
                          {item.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold shrink-0">
                          {formatCurrency(item.amountIdr)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2 px-3 py-2 bg-[#EBF3FA]/60 font-bold text-[#0B1B3A]">
                      <span>Total Aset</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(balanceSheet.totalAssetsIdr)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-semibold text-[#8F670D] mb-1.5">
                    Kewajiban &amp; Ekuitas (Liabilities &amp; Equity)
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {balanceSheet.liabilities.map((item) => (
                      <div key={item.accountId} className="flex justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-slate-500 mr-2">{item.code}</span>
                          {item.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold shrink-0">
                          {formatCurrency(item.amountIdr)}
                        </span>
                      </div>
                    ))}
                    {balanceSheet.equities.map((item) => (
                      <div key={item.accountId} className="flex justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-slate-500 mr-2">{item.code}</span>
                          {item.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold shrink-0">
                          {formatCurrency(item.amountIdr)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2 px-3 py-2 bg-[#FDF7E3]/60">
                      <span className="font-medium text-[#8F670D]">
                        Laba Periode Berjalan (Otomatis Laba Rugi)
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-[#8F670D] shrink-0">
                        {formatCurrency(balanceSheet.currentPeriodEarningsIdr)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0B1B3A] px-4 py-3 text-white">
                  <span className="text-xs sm:text-sm font-semibold">Total Kewajiban &amp; Ekuitas</span>
                  <span className="text-sm sm:text-base font-bold font-mono tabular-nums text-[#D9AA32] shrink-0">
                    {formatCurrency(balanceSheet.totalLiabilitiesIdr + balanceSheet.totalEquityIdr)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Performa Bulanan (Monthly Performance) */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Performa Bulanan (Monthly Performance)</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Rekapitulasi omzet, HPP, margin kotor, beban operasional, laba bersih, serta nilai PO &amp; SO per bulan.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportMonthlyCsv}
                  aria-label="Export Performa Bulanan CSV"
                >
                  <Download className="h-3.5 w-3.5 text-slate-700" />
                  CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportMonthlyExcel}
                  aria-label="Export Performa Bulanan Excel"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                  Excel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportMonthlyPdf}
                  aria-label="Export Performa Bulanan PDF"
                >
                  <FileText className="h-3.5 w-3.5 text-[#1B5E99]" />
                  PDF
                </Button>
              </div>
            </CardHeader>

            {/* Mobile Monthly Performance Cards */}
            <div className="divide-y divide-slate-100 md:hidden">
              {monthlyPerformance.months.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  Belum ada transaksi jurnal maupun order untuk dihitung per bulan.
                </div>
              ) : (
                monthlyPerformance.months.map((m) => (
                  <div key={`m_mp_${m.monthKey}`} className="p-4 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-[#0B1B3A]">{m.monthLabel}</span>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          m.netIncomeIdr >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        Laba: {formatCurrency(m.netIncomeIdr)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Omzet</span>
                        <span className="font-mono tabular-nums font-semibold text-[#154C7E]">
                          {formatCompactIdr(m.revenueIdr)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Margin Kotor</span>
                        <span className="font-mono tabular-nums font-semibold text-emerald-700">
                          {m.grossMarginPercent.toFixed(1)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Nilai PO ({m.poCount})</span>
                        <span className="font-mono tabular-nums text-slate-700">
                          {formatCompactIdr(m.poTotalIdr)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Nilai SO ({m.soCount})</span>
                        <span className="font-mono tabular-nums text-slate-700">
                          {formatCompactIdr(m.soTotalIdr)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop Monthly Performance Table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Bulan</th>
                    <th className="py-3 px-3 font-semibold text-right">Omzet (Revenue)</th>
                    <th className="py-3 px-3 font-semibold text-right">HPP (COGS)</th>
                    <th className="py-3 px-3 font-semibold text-right">Laba Kotor</th>
                    <th className="py-3 px-3 font-semibold text-right">Margin %</th>
                    <th className="py-3 px-3 font-semibold text-right">Beban OpEx</th>
                    <th className="py-3 px-3 font-semibold text-right">Laba Bersih</th>
                    <th className="py-3 px-3 font-semibold text-right">Nilai PO</th>
                    <th className="py-3 px-4 font-semibold text-right">Nilai SO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlyPerformance.months.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        Belum ada transaksi jurnal maupun order untuk dihitung per bulan.
                      </td>
                    </tr>
                  ) : (
                    monthlyPerformance.months.map((m) => (
                      <tr key={m.monthKey} className="hover:bg-[#F4F7FB]">
                        <td className="py-2.5 px-4 font-semibold text-[#0B1B3A] whitespace-nowrap">
                          {m.monthLabel}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#154C7E] font-medium">
                          {formatCurrency(m.revenueIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {formatCurrency(m.cogsIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#0B1B3A]">
                          {formatCurrency(m.grossProfitIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                          {m.grossMarginPercent.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-red-700">
                          {formatCurrency(m.operatingExpensesIdr)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                            m.netIncomeIdr >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {formatCurrency(m.netIncomeIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          <div>{formatCurrency(m.poTotalIdr)}</div>
                          <div className="text-[10px] text-slate-400">{m.poCount} PO</div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                          <div>{formatCurrency(m.soTotalIdr)}</div>
                          <div className="text-[10px] text-slate-400">{m.soCount} SO</div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-[#0B1B3A] text-white font-semibold">
                  <tr>
                    <td className="py-3 px-4">TOTAL AKUMULASI</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(monthlyPerformance.totalRevenueIdr)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(monthlyPerformance.totalCogsIdr)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(monthlyPerformance.totalGrossProfitIdr)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#D9AA32]">
                      {monthlyPerformance.totalRevenueIdr > 0
                        ? `${((monthlyPerformance.totalGrossProfitIdr / monthlyPerformance.totalRevenueIdr) * 100).toFixed(1)}%`
                        : '0.0%'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(monthlyPerformance.totalOperatingExpensesIdr)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#D9AA32]">
                      {formatCurrency(monthlyPerformance.totalNetIncomeIdr)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(monthlyPerformance.totalPoIdr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatCurrency(monthlyPerformance.totalSoIdr)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 4: DAFTAR AKUN / CHART OF ACCOUNTS (CoA)                    */}
        {/* =============================================================== */}
        <TabsContent value="coa" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 max-w-lg">
              <div className="relative">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                <Input
                  aria-label="Cari daftar akun"
                  className="pl-9"
                  placeholder="Cari kode atau nama akun..."
                  value={coaSearch}
                  onChange={(e) => setCoaSearch(e.target.value)}
                />
              </div>
              <NativeSelect
                aria-label="Filter kategori akun"
                value={coaCategoryFilter}
                onChange={(e) => setCoaCategoryFilter(e.target.value)}
              >
                <option value="ALL">Semua Kategori</option>
                <option value="Aset">Aset</option>
                <option value="Kewajiban">Kewajiban</option>
                <option value="Ekuitas">Ekuitas</option>
                <option value="Pendapatan">Pendapatan</option>
                <option value="Beban">Beban</option>
              </NativeSelect>
            </div>
            {canWrite && (
              <Button type="button" variant="accent" size="sm" onClick={() => openCoaModal()}>
                <Plus className="h-4 w-4" />
                Tambah Akun (CoA)
              </Button>
            )}
          </div>

          {/* Mobile CoA Cards */}
          <div className="space-y-2.5 md:hidden">
            {filteredCoaRows.map((r) => (
              <Card key={`m_coa_${r.account.id}`}>
                <CardContent className="p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-[#0B1B3A]">
                        <span className="font-mono text-[#1B5E99] mr-1.5">{r.account.code}</span>
                        {r.account.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Normal: {r.account.normalBalance} · {r.account.active ? 'Aktif' : 'Nonaktif'}
                      </div>
                    </div>
                    <StatusLabel
                      status={r.account.category}
                      tone={getCategoryTone(r.account.category)}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Saldo Berjalan</span>
                      <span className="font-mono tabular-nums font-bold text-[#0B1B3A]">
                        {formatCurrency(r.closingBalanceIdr)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAccountId(r.account.id);
                          setActiveTab('ledger');
                        }}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        Buku Besar
                      </Button>
                      {canWrite && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openCoaModal(r.account)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {isDirektur && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Hapus akun ${r.account.code}`}
                          className="text-red-600 hover:bg-red-50 px-2"
                          onClick={() =>
                            setConfirmDialog({
                              title: `Hapus Akun ${r.account.code} — ${r.account.name}?`,
                              description:
                                'Akun CoA ini akan dihapus permanen dari daftar akun perusahaan.',
                              confirmLabel: 'Hapus Akun',
                              tone: 'danger',
                              onConfirm: async () => {
                                await erp.deleteChartAccount(r.account.id);
                              },
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop CoA Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Kode Akun</th>
                    <th className="py-3 px-3 font-semibold">Nama Akun</th>
                    <th className="py-3 px-3 font-semibold">Kategori</th>
                    <th className="py-3 px-3 font-semibold">Saldo Normal</th>
                    <th className="py-3 px-3 font-semibold text-right">Saldo Berjalan (IDR)</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCoaRows.map((r) => (
                    <tr key={r.account.id} className="hover:bg-[#F4F7FB]">
                      <td className="py-3 px-4 font-mono font-bold text-[#0B1B3A]">
                        {r.account.code}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-[#0B1B3A]">{r.account.name}</div>
                        {r.account.description && (
                          <div className="text-[11px] text-slate-500">{r.account.description}</div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <StatusLabel
                          status={r.account.category}
                          tone={getCategoryTone(r.account.category)}
                        />
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600">
                        {r.account.normalBalance}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#0B1B3A]">
                        {formatCurrency(r.closingBalanceIdr)}
                      </td>
                      <td className="py-3 px-3">
                        <StatusLabel
                          status={r.account.active ? 'Aktif' : 'Nonaktif'}
                          tone={r.account.active ? 'success' : 'neutral'}
                        />
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedAccountId(r.account.id);
                              setActiveTab('ledger');
                            }}
                          >
                            <Layers className="h-3.5 w-3.5" />
                            Buku Besar
                          </Button>
                          {canWrite && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openCoaModal(r.account)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          )}
                          {isDirektur && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Hapus akun ${r.account.code}`}
                              title="Hapus akun CoA"
                              className="text-red-600 hover:bg-red-50"
                              onClick={() =>
                                setConfirmDialog({
                                  title: `Hapus Akun ${r.account.code} — ${r.account.name}?`,
                                  description:
                                    'Akun CoA ini akan dihapus permanen dari daftar akun perusahaan.',
                                  confirmLabel: 'Hapus Akun',
                                  tone: 'danger',
                                  onConfirm: async () => {
                                    await erp.deleteChartAccount(r.account.id);
                                  },
                                })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 5: HUTANG & PIUTANG (AP / AR INVOICES)                      */}
        {/* =============================================================== */}
        <TabsContent value="invoices" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md">
            <NativeSelect
              aria-label="Filter jenis ledger invoice"
              value={invoiceLedgerFilter}
              onChange={(e) => setInvoiceLedgerFilter(e.target.value as 'ALL' | 'AP' | 'AR')}
            >
              <option value="ALL">Semua Tagihan (AP &amp; AR)</option>
              <option value="AP">Hutang Supplier (AP)</option>
              <option value="AR">Piutang Customer (AR)</option>
            </NativeSelect>
            <NativeSelect
              aria-label="Filter status invoice"
              value={invoiceStatusFilter}
              onChange={(e) => setInvoiceStatusFilter(e.target.value)}
            >
              <option value="ALL">Semua Status</option>
              <option value="UNPAID">UNPAID</option>
              <option value="PARTIAL">PARTIAL</option>
              <option value="OVERDUE">OVERDUE</option>
              <option value="PAID">PAID</option>
            </NativeSelect>
          </div>

          {/* Mobile AP/AR Invoice Cards */}
          <div className="space-y-3 md:hidden">
            {filteredInvoices.map((inv) => {
              const idrBalance = convertToIdr(
                inv.balanceDue,
                inv.currency,
                inv.exchangeRate || rate
              );
              const linkedCustomer =
                inv.ledgerType === 'AR'
                  ? state.customers.find((c) => c.id === inv.counterpartyId)
                  : undefined;
              const linkedSupplier =
                inv.ledgerType === 'AP'
                  ? state.suppliers.find((s) => s.id === inv.counterpartyId)
                  : undefined;
              const linkedSo =
                inv.ledgerType === 'AR'
                  ? state.salesOrders.find(
                      (s) => s.id === inv.referenceOrderId || s.soNumber === inv.referenceOrderNumber
                    )
                  : undefined;
              return (
                <Card key={`m_inv_${inv.id}`}>
                  <CardContent className="p-4 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-bold text-[#0B1B3A] text-sm">
                          {inv.invoiceNumber}
                        </div>
                        <div className="font-medium text-slate-700">{inv.counterpartyName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {inv.referenceOrderNumber || '-'} · Jatuh Tempo: {inv.dueDate}
                        </div>
                        {inv.ledgerType === 'AR' && (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600 font-mono">
                            <span>FP: {inv.taxInvoiceNumber || linkedSo?.taxInvoiceNumber || '-'}</span>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() =>
                                  setTaxModalInv({
                                    inv,
                                    taxNo: inv.taxInvoiceNumber || linkedSo?.taxInvoiceNumber || '',
                                  })
                                }
                                className="inline-flex items-center text-[#1B5E99] hover:underline"
                                title="Edit No. Faktur Pajak"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <StatusLabel status={inv.status} tone={getInvTone(inv.status)} />
                        <span className="text-[10px] font-semibold text-slate-500">
                          {inv.ledgerType === 'AP' ? 'AP (Hutang)' : 'AR (Piutang)'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Total Tagihan</span>
                        <span className="font-mono tabular-nums font-medium">
                          {formatCurrency(inv.totalAmount, inv.currency)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Sisa Tagihan</span>
                        <span className="font-mono tabular-nums font-bold text-[#0B1B3A]">
                          {formatCurrency(inv.balanceDue, inv.currency)}
                        </span>
                        {inv.currency === 'USD' && inv.balanceDue > 0 && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            ≈ {formatCurrency(idrBalance, 'IDR')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        aria-label={`Cetak Invoice ${inv.invoiceNumber}`}
                        onClick={() =>
                          openPrintPreview(
                            buildSalesInvoicePrintDoc(
                              inv,
                              state.settings,
                              linkedCustomer,
                              linkedSo,
                              linkedSupplier
                            ),
                            () =>
                              exportSalesInvoicePdf(
                                inv,
                                state.settings,
                                linkedCustomer,
                                linkedSo,
                                linkedSupplier
                              )
                          )
                        }
                      >
                        <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                        Cetak
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() =>
                          void exportSalesInvoicePdf(
                            inv,
                            state.settings,
                            linkedCustomer,
                            linkedSo,
                            linkedSupplier
                          )
                        }
                      >
                        <FileText className="h-3.5 w-3.5 text-[#1B5E99]" />
                        PDF
                      </Button>
                      {(inv.payments || []).length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => setReceiptModalInv(inv)}
                        >
                          <Receipt className="h-3.5 w-3.5 text-emerald-700" />
                          Kwitansi ({(inv.payments || []).length})
                        </Button>
                      )}
                      {canWrite && inv.balanceDue > 0 && (
                        <Button
                          type="button"
                          variant="accent"
                          size="sm"
                          className="flex-1"
                          onClick={() => openPaymentModal(inv)}
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          Catat Pembayaran
                        </Button>
                      )}
                      {isDirektur && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Hapus invoice ${inv.invoiceNumber}`}
                          className="text-red-600 hover:bg-red-50 px-2"
                          onClick={() =>
                            setConfirmDialog({
                              title: `Hapus Invoice ${inv.invoiceNumber}?`,
                              description:
                                'Catatan tagihan beserta riwayat cicilan pada invoice ini akan dihapus permanen.',
                              confirmLabel: 'Hapus Invoice',
                              tone: 'danger',
                              onConfirm: async () => {
                                await erp.deleteInvoice(inv.id);
                              },
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Hapus
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop AP/AR Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Nomor Invoice</th>
                    <th className="py-3 px-3 font-semibold">Jenis</th>
                    <th className="py-3 px-3 font-semibold">Partner (Supplier / Customer)</th>
                    <th className="py-3 px-3 font-semibold">Ref Order / Faktur Pajak</th>
                    <th className="py-3 px-3 font-semibold">Jatuh Tempo</th>
                    <th className="py-3 px-3 font-semibold text-right">Total Tagihan</th>
                    <th className="py-3 px-3 font-semibold text-right">Dibayar</th>
                    <th className="py-3 px-3 font-semibold text-right">Sisa (IDR Eqv)</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((inv) => {
                    const idrBalance = convertToIdr(
                      inv.balanceDue,
                      inv.currency,
                      inv.exchangeRate || rate
                    );
                    const linkedCustomer =
                      inv.ledgerType === 'AR'
                        ? state.customers.find((c) => c.id === inv.counterpartyId)
                        : undefined;
                    const linkedSupplier =
                      inv.ledgerType === 'AP'
                        ? state.suppliers.find((s) => s.id === inv.counterpartyId)
                        : undefined;
                    const linkedSo =
                      inv.ledgerType === 'AR'
                        ? state.salesOrders.find(
                            (s) => s.id === inv.referenceOrderId || s.soNumber === inv.referenceOrderNumber
                          )
                        : undefined;
                    return (
                      <tr key={inv.id} className="hover:bg-[#F4F7FB]">
                        <td className="py-3 px-4 font-mono font-semibold text-[#0B1B3A]">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-3 px-3">
                          <StatusLabel
                            status={inv.ledgerType === 'AP' ? 'AP (Hutang)' : 'AR (Piutang)'}
                            tone={inv.ledgerType === 'AP' ? 'warning' : 'info'}
                          />
                        </td>
                        <td className="py-3 px-3 font-medium text-slate-800">
                          {inv.counterpartyName}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-500">
                          <div>{inv.referenceOrderNumber || '-'}</div>
                          {inv.ledgerType === 'AR' && (
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                              <span>FP: {inv.taxInvoiceNumber || linkedSo?.taxInvoiceNumber || '-'}</span>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTaxModalInv({
                                      inv,
                                      taxNo: inv.taxInvoiceNumber || linkedSo?.taxInvoiceNumber || '',
                                    })
                                  }
                                  className="text-[#1B5E99] hover:underline"
                                  title="Edit No. Seri Faktur Pajak"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-slate-600">
                          {inv.dueDate}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {formatCurrency(inv.totalAmount, inv.currency)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                          {formatCurrency(inv.paidAmount, inv.currency)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                          <div>{formatCurrency(inv.balanceDue, inv.currency)}</div>
                          {inv.currency === 'USD' && inv.balanceDue > 0 && (
                            <div className="text-[10px] text-slate-400">
                              ≈ {formatCurrency(idrBalance, 'IDR')}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <StatusLabel status={inv.status} tone={getInvTone(inv.status)} />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Cetak Invoice ${inv.invoiceNumber}`}
                              title="Tampilkan Pratinjau & Cetak A4"
                              onClick={() =>
                                openPrintPreview(
                                  buildSalesInvoicePrintDoc(
                                    inv,
                                    state.settings,
                                    linkedCustomer,
                                    linkedSo,
                                    linkedSupplier
                                  ),
                                  () =>
                                    exportSalesInvoicePdf(
                                      inv,
                                      state.settings,
                                      linkedCustomer,
                                      linkedSo,
                                      linkedSupplier
                                    )
                                )
                              }
                            >
                              <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                              Cetak
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              title="Unduh Invoice Resmi PDF"
                              onClick={() =>
                                void exportSalesInvoicePdf(
                                  inv,
                                  state.settings,
                                  linkedCustomer,
                                  linkedSo,
                                  linkedSupplier
                                )
                              }
                            >
                              <FileText className="h-3.5 w-3.5 text-[#1B5E99]" />
                              PDF
                            </Button>
                            {(inv.payments || []).length > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                title="Cetak Kwitansi Pembayaran"
                                onClick={() => setReceiptModalInv(inv)}
                              >
                                <Receipt className="h-3.5 w-3.5 text-emerald-700" />
                                Kwitansi
                              </Button>
                            )}
                            {canWrite && inv.balanceDue > 0 ? (
                              <Button
                                type="button"
                                variant="accent"
                                size="sm"
                                onClick={() => openPaymentModal(inv)}
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                Bayar
                              </Button>
                            ) : inv.balanceDue <= 0 ? (
                              <span className="inline-flex items-center px-1.5 text-[11px] font-semibold text-emerald-700">
                                Lunas
                              </span>
                            ) : null}
                            {isDirektur && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus invoice ${inv.invoiceNumber}`}
                                title="Hapus invoice permanen"
                                className="text-red-600 hover:bg-red-50"
                                onClick={() =>
                                  setConfirmDialog({
                                    title: `Hapus Invoice ${inv.invoiceNumber}?`,
                                    description:
                                      'Catatan tagihan beserta riwayat cicilan pada invoice ini akan dihapus permanen.',
                                    confirmLabel: 'Hapus Invoice',
                                    tone: 'danger',
                                    onConfirm: async () => {
                                      await erp.deleteInvoice(inv.id);
                                    },
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 6: AGING REPORT                                             */}
        {/* =============================================================== */}
        <TabsContent value="aging">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Aging Hutang Supplier (AP - Ekuivalen IDR)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-3 px-4">Kategori Umur</th>
                      <th className="py-3 px-4 text-right">Nominal Sisa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {agingBuckets.map((b) => (
                      <tr key={b}>
                        <td className="py-3 px-4 font-medium text-slate-800">{b}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                          {formatCurrency(apAging[b], 'IDR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 border-t border-slate-200 font-bold text-[#0B1B3A]">
                    <tr>
                      <td className="py-3 px-4">Total Hutang (AP)</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatCurrency(
                          agingBuckets.reduce((s, b) => s + apAging[b], 0),
                          'IDR'
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Aging Piutang Customer (AR - Ekuivalen IDR)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-3 px-4">Kategori Umur</th>
                      <th className="py-3 px-4 text-right">Nominal Sisa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {agingBuckets.map((b) => (
                      <tr key={b}>
                        <td className="py-3 px-4 font-medium text-slate-800">{b}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                          {formatCurrency(arAging[b], 'IDR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 border-t border-slate-200 font-bold text-[#0B1B3A]">
                    <tr>
                      <td className="py-3 px-4">Total Piutang (AR)</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatCurrency(
                          agingBuckets.reduce((s, b) => s + arAging[b], 0),
                          'IDR'
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 7: TUTUP BUKU PERIODE & BUDGET BULANAN                      */}
        {/* =============================================================== */}
        <TabsContent value="closing" className="space-y-5">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {/* Period Closing Lock Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock className="h-4 w-4 text-[#1B5E99]" />
                  {tr('Kunci Periode Akuntansi (Period Closing)', 'Accounting Period Closing Lock')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-600">
                  {tr(
                    'Mengunci periode (YYYY-MM) mencegah posting jurnal baru, void jurnal, penerimaan barang, pengiriman SO, pembayaran invoice, atau retur bertanggal di bulan yang sudah tutup buku.',
                    'Locking a period (YYYY-MM) prevents backdated journals, voids, goods receipts, deliveries, payments, or returns within that closed month.'
                  )}
                </p>

                {canClosePeriod && (
                  <form
                    className="space-y-2.5 rounded-lg border border-slate-200 bg-[#F4F7FB] p-3"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!closingMonth) return;
                      setClosingBusy(true);
                      try {
                        await erp.togglePeriodClosing(closingMonth, true, closingNotes);
                        setClosingNotes('');
                      } finally {
                        setClosingBusy(false);
                      }
                    }}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <Label htmlFor="closing-month">Periode (Bulan)</Label>
                        <Input
                          id="closing-month"
                          type="month"
                          required
                          value={closingMonth}
                          onChange={(e) => setClosingMonth(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="closing-notes">Catatan Tutup Buku</Label>
                        <Input
                          id="closing-notes"
                          placeholder="Rekonsiliasi & SPT masa final..."
                          value={closingNotes}
                          onChange={(e) => setClosingNotes(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" variant="default" size="sm" disabled={closingBusy}>
                        <Lock className="h-3.5 w-3.5" />
                        Tutup Buku Periode
                      </Button>
                    </div>
                  </form>
                )}

                {state.periodClosings.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                    Belum ada periode akuntansi yang dikunci.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {state.periodClosings
                      .slice()
                      .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
                      .map((pc) => (
                        <div
                          key={pc.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-[#0B1B3A]">{pc.periodKey}</span>
                              <StatusLabel
                                status={pc.locked ? 'LOCKED' : 'OPEN'}
                                tone={pc.locked ? 'danger' : 'success'}
                              />
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Oleh {pc.lockedByName || pc.lockedBy} · {(pc.lockedAt || '').slice(0, 10)}
                              {pc.notes ? ` · ${pc.notes}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {canClosePeriod && (
                              <Button
                                type="button"
                                variant={pc.locked ? 'outline' : 'accent'}
                                size="sm"
                                onClick={() =>
                                  void erp.togglePeriodClosing(
                                    pc.periodKey,
                                    !pc.locked,
                                    pc.locked ? 'Dibuka kembali untuk penyesuaian' : pc.notes
                                  )
                                }
                              >
                                {pc.locked ? (
                                  <>
                                    <Unlock className="h-3.5 w-3.5 text-amber-700" />
                                    Buka Kunci
                                  </>
                                ) : (
                                  <>
                                    <Lock className="h-3.5 w-3.5" />
                                    Kunci Lagi
                                  </>
                                )}
                              </Button>
                            )}
                            {isDirektur && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus periode ${pc.periodKey}`}
                                title="Hapus catatan tutup buku"
                                className="text-red-600 hover:bg-red-50"
                                onClick={() =>
                                  setConfirmDialog({
                                    title: `Hapus Catatan Tutup Buku ${pc.periodKey}?`,
                                    description:
                                      'Data penguncian periode akuntansi ini akan dihapus permanen.',
                                    confirmLabel: 'Hapus',
                                    tone: 'danger',
                                    onConfirm: async () => {
                                      await erp.deletePeriodClosing(pc.id);
                                    },
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Monthly Budget Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="h-4 w-4 text-emerald-700" />
                  {tr('Atur Target Omzet & Budget Biaya Bulanan', 'Monthly Revenue Target & Cost Budget')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-600">
                  {tr(
                    'Budget bulanan otomatis dibandingkan dengan Realisasi Buku Besar (Dashboard Direktur, Angel Investor & Laporan Budget vs Realisasi).',
                    'Monthly budgets are automatically compared against General Ledger actuals across the Dashboard and Budget vs Actual Reports.'
                  )}
                </p>
                {canWriteBudget ? (
                  <form
                    className="space-y-3 rounded-lg border border-slate-200 bg-[#F4F7FB] p-3.5"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBudgetBusy(true);
                      try {
                        await erp.saveBudget({
                          periodKey: budgetMonth,
                          targetRevenueIdr: Number(budgetTargetRev) || 0,
                          maxCogsIdr: Number(budgetMaxCogs) || 0,
                          maxOpexIdr: Number(budgetMaxOpex) || 0,
                          notes: budgetNotes,
                        });
                      } finally {
                        setBudgetBusy(false);
                      }
                    }}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="budget-month">Periode Bulan</Label>
                        <Input
                          id="budget-month"
                          type="month"
                          required
                          value={budgetMonth}
                          onChange={(e) => setBudgetMonth(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="budget-target-rev">Target Omzet / Revenue (IDR)</Label>
                        <Input
                          id="budget-target-rev"
                          inputMode="numeric"
                          required
                          value={budgetTargetRev}
                          onChange={(e) => setBudgetTargetRev(sanitizeIntegerDigits(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="budget-max-cogs">Plafon HPP / COGS (IDR)</Label>
                        <Input
                          id="budget-max-cogs"
                          inputMode="numeric"
                          required
                          value={budgetMaxCogs}
                          onChange={(e) => setBudgetMaxCogs(sanitizeIntegerDigits(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="budget-max-opex">Plafon Beban Operasional (IDR)</Label>
                        <Input
                          id="budget-max-opex"
                          inputMode="numeric"
                          required
                          value={budgetMaxOpex}
                          onChange={(e) => setBudgetMaxOpex(sanitizeIntegerDigits(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="budget-notes">Catatan Target / Asumsi</Label>
                      <Input
                        id="budget-notes"
                        placeholder="Target ekspansi proyek B2B & tender Q4..."
                        value={budgetNotes}
                        onChange={(e) => setBudgetNotes(e.target.value)}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" variant="accent" size="sm" disabled={budgetBusy}>
                        <Target className="h-3.5 w-3.5" />
                        Simpan Budget Bulanan
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Role Anda hanya memiliki akses lihat (read-only) untuk pengaturan budget.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Budget vs Actual Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tr('Perbandingan Target Budget vs Realisasi Buku Besar', 'Monthly Budget vs Ledger Actual')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {budgetRows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Belum ada budget bulanan yang ditetapkan.
                </div>
              ) : (
                <>
                  <div className="space-y-3 p-4 md:hidden">
                    {budgetRows.map((b) => {
                      const budgetDoc = state.budgets.find((x) => x.periodKey === b.periodKey);
                      return (
                        <div key={`m_bdg_${b.periodKey}`} className="rounded-lg border border-slate-200 p-3 text-xs space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#0B1B3A]">{b.monthLabel}</span>
                            <div className="flex items-center gap-1.5">
                              <StatusLabel
                                status={`${b.revenueAttainmentPercent.toFixed(0)}% Omzet`}
                                tone={b.revenueAttainmentPercent >= 90 ? 'success' : 'warning'}
                              />
                              {isDirektur && budgetDoc && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Hapus target budget ${b.periodKey}`}
                                  className="text-red-600 hover:bg-red-50 h-7 w-7"
                                  onClick={() =>
                                    setConfirmDialog({
                                      title: `Hapus Target Budget ${b.monthLabel}?`,
                                      description:
                                        'Data target omzet & budget biaya bulanan ini akan dihapus permanen.',
                                      confirmLabel: 'Hapus Budget',
                                      tone: 'danger',
                                      onConfirm: async () => {
                                        await erp.deleteBudget(budgetDoc.id);
                                      },
                                    })
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Target Omzet</span>
                              <span className="font-mono font-semibold">{formatCurrency(b.targetRevenueIdr)}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-slate-500 block">Realisasi Omzet</span>
                              <span className="font-mono font-bold text-[#1B5E99]">{formatCurrency(b.actualRevenueIdr)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Target Laba Bersih</span>
                              <span className="font-mono">{formatCurrency(b.targetNetIncomeIdr)}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-slate-500 block">Realisasi Laba Bersih</span>
                              <span className={`font-mono font-bold ${b.actualNetIncomeIdr >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {formatCurrency(b.actualNetIncomeIdr)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-3 px-4 font-semibold">Periode</th>
                          <th className="py-3 px-3 font-semibold text-right">Target Omzet</th>
                          <th className="py-3 px-3 font-semibold text-right">Realisasi Omzet</th>
                          <th className="py-3 px-3 font-semibold text-right">Capaian</th>
                          <th className="py-3 px-3 font-semibold text-right">Budget HPP / OpEx</th>
                          <th className="py-3 px-3 font-semibold text-right">Realisasi HPP / OpEx</th>
                          <th className="py-3 px-3 font-semibold text-right">Target Net</th>
                          <th className="py-3 px-4 font-semibold text-right">Realisasi Net</th>
                          {isDirektur && <th className="py-3 px-4 font-semibold text-right">Aksi</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {budgetRows.map((b) => {
                          const budgetDoc = state.budgets.find((x) => x.periodKey === b.periodKey);
                          return (
                            <tr key={b.periodKey} className="hover:bg-[#F4F7FB]">
                              <td className="py-3 px-4 font-semibold text-[#0B1B3A]">
                                <div>{b.monthLabel}</div>
                                {b.notes && <div className="text-[10px] font-normal text-slate-400">{b.notes}</div>}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums">
                                {formatCurrency(b.targetRevenueIdr)}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#1B5E99]">
                                {formatCurrency(b.actualRevenueIdr)}
                              </td>
                              <td className="py-3 px-3 text-right">
                                <StatusLabel
                                  status={`${b.revenueAttainmentPercent.toFixed(1)}%`}
                                  tone={b.revenueAttainmentPercent >= 90 ? 'success' : b.revenueAttainmentPercent >= 60 ? 'warning' : 'danger'}
                                />
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                                {formatCurrency(b.maxCogsIdr + b.maxOpexIdr)}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums">
                                {formatCurrency(b.actualCogsIdr + b.actualOpexIdr)}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                                {formatCurrency(b.targetNetIncomeIdr)}
                              </td>
                              <td
                                className={`py-3 px-4 text-right font-mono tabular-nums font-bold ${
                                  b.actualNetIncomeIdr >= b.targetNetIncomeIdr ? 'text-emerald-700' : 'text-amber-700'
                                }`}
                              >
                                {formatCurrency(b.actualNetIncomeIdr)}
                              </td>
                              {isDirektur && (
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  {budgetDoc ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Hapus target budget ${b.periodKey}`}
                                      title="Hapus target budget bulanan"
                                      className="text-red-600 hover:bg-red-50"
                                      onClick={() =>
                                        setConfirmDialog({
                                          title: `Hapus Target Budget ${b.monthLabel}?`,
                                          description:
                                            'Data target omzet & budget biaya bulanan ini akan dihapus permanen.',
                                          confirmLabel: 'Hapus Budget',
                                          tone: 'danger',
                                          onConfirm: async () => {
                                            await erp.deleteBudget(budgetDoc.id);
                                          },
                                        })
                                      }
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">-</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ================================================================= */}
      {/* MODAL 1: CREATE MANUAL DOUBLE-ENTRY JOURNAL (MOBILE-FIRST ERGONOMIC) */}
      {/* ================================================================= */}
      <Dialog open={showJournalModal} onOpenChange={setShowJournalModal}>
        <DialogContent size="xl" structured>
          <DialogHeader structured>
            <DialogTitle>Buat Jurnal Umum Baru (Double-Entry)</DialogTitle>
            <DialogDescription>
              Masukkan nilai Debit atau Kredit (hanya angka rupiah). Gunakan tombol &ldquo;Isi Sisa&rdquo; untuk menyamakan otomatis.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draftValidation.valid) return;
              setJrnSaving(true);
              try {
                const ok = await erp.createJournalEntry({
                  entryDate: jrnDate,
                  journalType: jrnType,
                  referenceNumber: jrnRefNo,
                  description: jrnDesc,
                  lines: jrnLines.map((l) => ({
                    accountId: l.accountId,
                    debitIdr: Number(l.debitIdr) || 0,
                    creditIdr: Number(l.creditIdr) || 0,
                    memo: l.memo,
                  })),
                });
                if (ok) {
                  setShowJournalModal(false);
                }
              } catch (err) {
                console.error('Error posting journal:', err);
                toast.error('Terjadi kesalahan saat memposting jurnal.');
              } finally {
                setJrnSaving(false);
              }
            }}
          >
            <DialogBody>
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="jrn-date">Tanggal Transaksi</Label>
                    <Input
                      id="jrn-date"
                      type="date"
                      required
                      value={jrnDate}
                      onChange={(e) => setJrnDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jrn-type">Tipe Jurnal</Label>
                    <NativeSelect
                      id="jrn-type"
                      value={jrnType}
                      onChange={(e) => setJrnType(e.target.value as JournalEntryType)}
                    >
                      <option value="Jurnal Umum">Jurnal Umum</option>
                      <option value="Kas & Bank">Kas &amp; Bank</option>
                      <option value="Penyesuaian">Penyesuaian</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jrn-ref">No. Bukti / Referensi</Label>
                    <Input
                      id="jrn-ref"
                      placeholder="Contoh: BKK-2026-011"
                      value={jrnRefNo}
                      onChange={(e) => setJrnRefNo(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="jrn-desc">Keterangan Transaksi</Label>
                  <Input
                    id="jrn-desc"
                    required
                    placeholder="Contoh: Biaya operasional administrasi bank / transfer antar rekening"
                    value={jrnDesc}
                    onChange={(e) => setJrnDesc(e.target.value)}
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Baris Akun Jurnal (Min. 2 Baris)
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setJrnLines((prev) => [
                        ...prev,
                        {
                          key: `line_${Date.now()}_${prev.length}`,
                          accountId: sortedAccounts[0]?.id || '',
                          debitIdr: '',
                          creditIdr: '',
                          memo: '',
                        },
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Baris
                  </Button>
                </div>

                {/* MOBILE STACKED CARD ENTRY (< md) */}
                <div className="space-y-3 md:hidden">
                  {jrnLines.map((line, idx) => {
                    const debitVal = Number(line.debitIdr) || 0;
                    const creditVal = Number(line.creditIdr) || 0;
                    return (
                      <div
                        key={`m_line_${line.key}`}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#0B1B3A]">
                            Baris #{idx + 1}
                          </span>
                          {jrnLines.length > 2 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus baris ${idx + 1}`}
                              className="text-red-600 hover:bg-red-50 px-2"
                              onClick={() =>
                                setJrnLines((prev) => prev.filter((x) => x.key !== line.key))
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Hapus
                            </Button>
                          )}
                        </div>

                        <div className="space-y-1">
                          <Label>Akun (Chart of Accounts)</Label>
                          <NativeSelect
                            aria-label={`Akun baris ${idx + 1}`}
                            value={line.accountId}
                            onChange={(e) =>
                              setJrnLines((prev) =>
                                prev.map((x) =>
                                  x.key === line.key ? { ...x, accountId: e.target.value } : x
                                )
                              )
                            }
                          >
                            {sortedAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="space-y-1">
                            <Label className="text-[#154C7E]">Debit (IDR)</Label>
                            <Input
                              aria-label={`Debit baris ${idx + 1}`}
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="0"
                              className="text-right font-mono font-semibold text-[#154C7E] bg-white"
                              value={line.debitIdr}
                              onChange={(e) => handleDebitChange(line.key, e.target.value)}
                            />
                            {debitVal > 0 ? (
                              <div className="text-[11px] font-mono tabular-nums text-[#154C7E] text-right font-medium">
                                {formatCurrency(debitVal)}
                              </div>
                            ) : missingDebitForBalance > 0 && creditVal === 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleDebitChange(line.key, String(missingDebitForBalance))
                                }
                                className="w-full mt-1 inline-flex items-center justify-center gap-1 rounded-md border border-[#BFD9EF] bg-[#EBF3FA] px-2 py-1.5 text-[11px] font-semibold text-[#154C7E] hover:bg-[#dcebf7] cursor-pointer"
                              >
                                <Sparkles className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  Isi {formatCompactIdr(missingDebitForBalance)}
                                </span>
                              </button>
                            ) : null}
                          </div>

                          <div className="space-y-1">
                            <Label className="text-[#8F670D]">Kredit (IDR)</Label>
                            <Input
                              aria-label={`Kredit baris ${idx + 1}`}
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="0"
                              className="text-right font-mono font-semibold text-[#8F670D] bg-white"
                              value={line.creditIdr}
                              onChange={(e) => handleCreditChange(line.key, e.target.value)}
                            />
                            {creditVal > 0 ? (
                              <div className="text-[11px] font-mono tabular-nums text-[#8F670D] text-right font-medium">
                                {formatCurrency(creditVal)}
                              </div>
                            ) : missingCreditForBalance > 0 && debitVal === 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleCreditChange(line.key, String(missingCreditForBalance))
                                }
                                className="w-full mt-1 inline-flex items-center justify-center gap-1 rounded-md border border-[#EED58B] bg-[#FDF7E3] px-2 py-1.5 text-[11px] font-semibold text-[#8F670D] hover:bg-[#faefc9] cursor-pointer"
                              >
                                <Sparkles className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  Isi {formatCompactIdr(missingCreditForBalance)}
                                </span>
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label>Memo Baris (Opsional)</Label>
                          <Input
                            aria-label={`Memo baris ${idx + 1}`}
                            placeholder="Catatan singkat baris ini..."
                            className="bg-white"
                            value={line.memo}
                            onChange={(e) =>
                              setJrnLines((prev) =>
                                prev.map((x) =>
                                  x.key === line.key ? { ...x, memo: e.target.value } : x
                                )
                              )
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* DESKTOP TABLE ENTRY (md+) */}
                <div className="hidden md:block border border-slate-200 rounded-xl overflow-x-auto bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3.5">Akun (CoA)</th>
                        <th className="py-2.5 px-2">Memo Baris</th>
                        <th className="py-2.5 px-2 w-40 text-right">Debit (IDR)</th>
                        <th className="py-2.5 px-2 w-40 text-right">Kredit (IDR)</th>
                        <th className="py-2.5 px-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {jrnLines.map((line, idx) => {
                        const debitVal = Number(line.debitIdr) || 0;
                        const creditVal = Number(line.creditIdr) || 0;
                        return (
                          <tr key={line.key} className="align-top">
                            <td className="py-2.5 px-3.5 min-w-[220px]">
                              <NativeSelect
                                aria-label={`Akun baris ${idx + 1}`}
                                value={line.accountId}
                                onChange={(e) =>
                                  setJrnLines((prev) =>
                                    prev.map((x) =>
                                      x.key === line.key ? { ...x, accountId: e.target.value } : x
                                    )
                                  )
                                }
                              >
                                {sortedAccounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.code} — {a.name}
                                  </option>
                                ))}
                              </NativeSelect>
                            </td>
                            <td className="py-2.5 px-2">
                              <Input
                                aria-label={`Memo baris ${idx + 1}`}
                                placeholder="Opsional..."
                                value={line.memo}
                                onChange={(e) =>
                                  setJrnLines((prev) =>
                                    prev.map((x) =>
                                      x.key === line.key ? { ...x, memo: e.target.value } : x
                                    )
                                  )
                                }
                              />
                            </td>
                            <td className="py-2.5 px-2">
                              <Input
                                aria-label={`Debit baris ${idx + 1}`}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="0"
                                className="text-right font-mono font-semibold text-[#154C7E]"
                                value={line.debitIdr}
                                onChange={(e) => handleDebitChange(line.key, e.target.value)}
                              />
                              {debitVal > 0 ? (
                                <div className="mt-1 text-[10px] font-mono tabular-nums text-[#154C7E] text-right">
                                  {formatCurrency(debitVal)}
                                </div>
                              ) : missingDebitForBalance > 0 && creditVal === 0 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDebitChange(line.key, String(missingDebitForBalance))
                                  }
                                  className="mt-1 w-full text-[10px] font-semibold text-[#154C7E] bg-[#EBF3FA] hover:bg-[#dcebf7] rounded px-1.5 py-0.5 text-right cursor-pointer"
                                >
                                  Isi {formatCurrency(missingDebitForBalance)}
                                </button>
                              ) : null}
                            </td>
                            <td className="py-2.5 px-2">
                              <Input
                                aria-label={`Kredit baris ${idx + 1}`}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="0"
                                className="text-right font-mono font-semibold text-[#8F670D]"
                                value={line.creditIdr}
                                onChange={(e) => handleCreditChange(line.key, e.target.value)}
                              />
                              {creditVal > 0 ? (
                                <div className="mt-1 text-[10px] font-mono tabular-nums text-[#8F670D] text-right">
                                  {formatCurrency(creditVal)}
                                </div>
                              ) : missingCreditForBalance > 0 && debitVal === 0 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCreditChange(line.key, String(missingCreditForBalance))
                                  }
                                  className="mt-1 w-full text-[10px] font-semibold text-[#8F670D] bg-[#FDF7E3] hover:bg-[#faefc9] rounded px-1.5 py-0.5 text-right cursor-pointer"
                                >
                                  Isi {formatCurrency(missingCreditForBalance)}
                                </button>
                              ) : null}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              {jrnLines.length > 2 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Hapus baris ${idx + 1}`}
                                  className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                                  onClick={() =>
                                    setJrnLines((prev) => prev.filter((x) => x.key !== line.key))
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </DialogBody>

            <DialogFooter>
              <div className="text-xs space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono tabular-nums text-slate-700">
                  <span>
                    Debit: <strong className="text-[#154C7E]">{formatCompactIdr(draftValidation.totalDebitIdr)}</strong>
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>
                    Kredit: <strong className="text-[#8F670D]">{formatCompactIdr(draftValidation.totalCreditIdr)}</strong>
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>
                    Selisih: <strong className="text-[#0B1B3A]">{formatCompactIdr(draftValidation.differenceIdr)}</strong>
                  </span>
                </div>
                <div
                  className={`font-semibold text-[11px] ${
                    draftValidation.valid ? 'text-emerald-700' : 'text-[#8F670D]'
                  }`}
                >
                  {draftValidation.valid ? 'Seimbang — Siap Diposting' : draftValidation.error}
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 shrink-0">
                <Button type="button" variant="outline" onClick={() => setShowJournalModal(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="default" disabled={!draftValidation.valid || jrnSaving}>
                  {jrnSaving ? 'Menyimpan...' : 'Posting ke Buku Besar'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* MODAL 2: JOURNAL VOUCHER DETAIL                                   */}
      {/* ================================================================= */}
      <Dialog open={!!viewJournal} onOpenChange={(open) => !open && setViewJournal(null)}>
        <DialogContent size="lg" structured>
          {viewJournal && (
            <>
              <DialogHeader structured>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>Voucher Jurnal {viewJournal.entryNumber}</DialogTitle>
                  <StatusLabel
                    status={viewJournal.status}
                    tone={viewJournal.status === 'Posted' ? 'success' : 'danger'}
                  />
                </div>
                <DialogDescription>
                  Tanggal: {viewJournal.entryDate} · Tipe: {viewJournal.journalType}
                  {viewJournal.referenceNumber ? ` · Ref: ${viewJournal.referenceNumber}` : ''}
                </DialogDescription>
              </DialogHeader>

              <DialogBody>
                <div className="rounded-xl bg-slate-50/80 border border-slate-200 p-3.5 text-xs space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Keterangan Transaksi
                  </div>
                  <div className="font-semibold text-[#0B1B3A]">{viewJournal.description}</div>
                  <div className="text-[11px] text-slate-500">
                    Dicatat oleh: {viewJournal.createdByName || viewJournal.createdBy}
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3.5">Kode</th>
                        <th className="py-2.5 px-3">Nama Akun</th>
                        <th className="py-2.5 px-3">Memo</th>
                        <th className="py-2.5 px-3 text-right">Debit (IDR)</th>
                        <th className="py-2.5 px-3.5 text-right">Kredit (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewJournal.lines.map((line, i) => (
                        <tr key={`${line.accountId}_${i}`}>
                          <td className="py-2.5 px-3.5 font-mono font-semibold">{line.accountCode}</td>
                          <td className="py-2.5 px-3 font-medium text-[#0B1B3A]">{line.accountName}</td>
                          <td className="py-2.5 px-3 text-slate-500">{line.memo || '-'}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#154C7E]">
                            {line.debitIdr > 0 ? formatCurrency(line.debitIdr) : '-'}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#8F670D]">
                            {line.creditIdr > 0 ? formatCurrency(line.creditIdr) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-[#0B1B3A]">
                      <tr>
                        <td colSpan={3} className="py-2.5 px-3.5 text-right">
                          Total Seimbang
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatCurrency(viewJournal.totalDebitIdr)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                          {formatCurrency(viewJournal.totalCreditIdr)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </DialogBody>

              <DialogFooter className="sm:justify-end">
                <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                  {isDirektur && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        const target = viewJournal;
                        setViewJournal(null);
                        setConfirmDialog({
                          title: `Hapus Permanen ${target.entryNumber}?`,
                          description:
                            'Dokumen jurnal beserta seluruh baris mutasinya akan dihapus permanen dari Buku Besar.',
                          confirmLabel: 'Hapus Permanen',
                          tone: 'danger',
                          onConfirm: async () => {
                            await erp.deleteJournalEntry(target.id);
                          },
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Hapus Permanen
                    </Button>
                  )}
                  {canWrite && viewJournal.status === 'Posted' && (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-amber-700 border-amber-200 hover:bg-amber-50"
                      onClick={() => {
                        const target = viewJournal;
                        setViewJournal(null);
                        setConfirmDialog({
                          title: `Void Jurnal ${target.entryNumber}?`,
                          description:
                            'Status jurnal akan diubah menjadi Void sehingga tidak dihitung lagi pada Buku Besar maupun Laporan Keuangan.',
                          confirmLabel: 'Ya, Void Jurnal',
                          tone: 'warning',
                          onConfirm: async () => {
                            await erp.voidJournalEntry(target.id);
                          },
                        });
                      }}
                    >
                      Void Jurnal
                    </Button>
                  )}
                  <Button type="button" variant="default" onClick={() => setViewJournal(null)}>
                    Tutup
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* MODAL 3: CREATE / EDIT CHART ACCOUNT (CoA)                        */}
      {/* ================================================================= */}
      <Dialog
        open={coaModal.open}
        onOpenChange={(open) => !open && setCoaModal((p) => ({ ...p, open: false }))}
      >
        <DialogContent size="md" structured>
          <DialogHeader structured>
            <DialogTitle>
              {coaModal.isNew ? 'Tambah Akun Buku Besar (CoA)' : `Edit Akun ${coaModal.code}`}
            </DialogTitle>
            <DialogDescription>
              Kelola klasifikasi akun sesuai standar akuntansi PT Domestiq Hub Indonesia.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await erp.saveChartAccount({
                id: coaModal.id,
                isNew: coaModal.isNew,
                code: coaModal.code,
                name: coaModal.name,
                category: coaModal.category,
                normalBalance: coaModal.normalBalance,
                openingBalanceIdr: Number(coaModal.openingBalanceIdr) || 0,
                description: coaModal.description,
                active: coaModal.active,
              });
              if (ok) setCoaModal((p) => ({ ...p, open: false }));
            }}
          >
            <DialogBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="coa-code">Kode Akun</Label>
                  <Input
                    id="coa-code"
                    required
                    placeholder="Contoh: 6105"
                    value={coaModal.code}
                    onChange={(e) => setCoaModal((p) => ({ ...p, code: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="coa-category">Kategori Akun</Label>
                  <NativeSelect
                    id="coa-category"
                    value={coaModal.category}
                    onChange={(e) => {
                      const cat = e.target.value as AccountCategory;
                      const defaultNormal: NormalBalance =
                        cat === 'Aset' || cat === 'Beban' ? 'Debit' : 'Kredit';
                      setCoaModal((p) => ({
                        ...p,
                        category: cat,
                        normalBalance: p.isNew ? defaultNormal : p.normalBalance,
                      }));
                    }}
                  >
                    <option value="Aset">Aset</option>
                    <option value="Kewajiban">Kewajiban</option>
                    <option value="Ekuitas">Ekuitas</option>
                    <option value="Pendapatan">Pendapatan</option>
                    <option value="Beban">Beban</option>
                  </NativeSelect>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="coa-name">Nama Akun</Label>
                <Input
                  id="coa-name"
                  required
                  placeholder="Contoh: Beban Pemeliharaan Armada"
                  value={coaModal.name}
                  onChange={(e) => setCoaModal((p) => ({ ...p, name: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="coa-normal">Saldo Normal</Label>
                  <NativeSelect
                    id="coa-normal"
                    value={coaModal.normalBalance}
                    onChange={(e) =>
                      setCoaModal((p) => ({ ...p, normalBalance: e.target.value as NormalBalance }))
                    }
                  >
                    <option value="Debit">Debit</option>
                    <option value="Kredit">Kredit</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="coa-status">Status Akun</Label>
                  <NativeSelect
                    id="coa-status"
                    value={coaModal.active ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setCoaModal((p) => ({ ...p, active: e.target.value === 'active' }))
                    }
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </NativeSelect>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="coa-desc">Keterangan Akun</Label>
                <Input
                  id="coa-desc"
                  placeholder="Fungsi atau cakupan pencatatan akun..."
                  value={coaModal.description}
                  onChange={(e) => setCoaModal((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCoaModal((p) => ({ ...p, open: false }))}
                >
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan Akun
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* MODAL 4: AP / AR PAYMENT RECORDING                               */}
      {/* ================================================================= */}
      <Dialog open={!!payInvoice} onOpenChange={(open) => !open && setPayInvoice(null)}>
        <DialogContent size="lg" structured>
          {payInvoice && (
            <>
              <DialogHeader structured>
                <DialogTitle>Catat Pembayaran {payInvoice.invoiceNumber}</DialogTitle>
                <DialogDescription>
                  {payInvoice.counterpartyName} · Sisa tagihan:{' '}
                  <strong className="font-mono">
                    {formatCurrency(payInvoice.balanceDue, payInvoice.currency)}
                  </strong>
                  . Jurnal Kas/Bank otomatis tercatat ke Buku Besar sesuai akun yang dipilih.
                </DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col flex-1 min-h-0"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const selectableCashAccounts =
                    cashBankAccounts.length > 0
                      ? cashBankAccounts
                      : sortedAccounts.filter((a) => a.active);
                  const chosenAcc =
                    selectableCashAccounts.find((a) => a.id === payAccountId) ||
                    selectableCashAccounts[0];
                  const paymentLabel = chosenAcc
                    ? `${payMethod} · ${chosenAcc.code} ${chosenAcc.name}`
                    : payMethod;
                  await erp.recordInvoicePayment(payInvoice.id, {
                    amount: Number(payAmount),
                    paymentMethod: paymentLabel,
                    cashBankAccountId: chosenAcc?.id,
                    referenceNo: payRef,
                    notes: payNotes,
                  });
                  setPayInvoice(null);
                }}
              >
                <DialogBody>
                  {(() => {
                    if (payInvoice.ledgerType !== 'AP') return null;
                    const linkedPo = state.purchaseOrders.find(
                      (p) =>
                        p.id === payInvoice.referenceOrderId ||
                        p.poNumber === payInvoice.referenceOrderNumber
                    );
                    if (!linkedPo) return null;
                    const match = computeThreeWayMatchStatus(linkedPo, state.invoices, rate);
                    const isOk = match.status === 'MATCHED';
                    const isVar = match.status === 'VARIANCE';
                    return (
                      <div
                        className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                          isOk
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : isVar
                              ? 'border-red-200 bg-red-50 text-red-800'
                              : 'border-amber-200 bg-amber-50 text-amber-900'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold">
                          <span>3-Way Match ({linkedPo.poNumber})</span>
                          <StatusLabel
                            status={match.status}
                            tone={isOk ? 'success' : isVar ? 'danger' : 'warning'}
                          />
                        </div>
                        <p className="mt-1 text-[11px]">{match.reason}</p>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="pay-amount">
                        Nominal Pembayaran ({payInvoice.currency}) — Mendukung Partial Payment
                      </Label>
                      <Input
                        id="pay-amount"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0.01}
                        max={payInvoice.balanceDue}
                        required
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="font-mono tabular-nums"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-account">Akun Kas / Bank</Label>
                      <NativeSelect
                        id="pay-account"
                        required
                        value={payAccountId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setPayAccountId(nextId);
                          const nextAcc = accountById.get(nextId);
                          if (nextAcc) {
                            const lowerName = nextAcc.name.toLowerCase();
                            if (lowerName.includes('kas') || lowerName.includes('tunai')) {
                              setPayMethod('Kas Tunai');
                            } else if (payMethod === 'Kas Tunai') {
                              setPayMethod('Transfer Bank');
                            }
                          }
                        }}
                      >
                        {(cashBankAccounts.length > 0
                          ? cashBankAccounts
                          : sortedAccounts.filter((a) => a.active)
                        ).map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.code} — {acc.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-method">Metode Pembayaran</Label>
                      <NativeSelect
                        id="pay-method"
                        value={payMethod}
                        onChange={(e) => setPayMethod(e.target.value)}
                      >
                        <option value="Transfer Bank">Transfer Bank</option>
                        <option value="Transfer Virtual Account">Transfer Virtual Account</option>
                        <option value="Giro / Cek">Giro / Cek</option>
                        <option value="Kas Tunai">Kas Tunai</option>
                        <option value="QRIS / Lainnya">QRIS / Lainnya</option>
                      </NativeSelect>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-ref">Nomor Referensi Transaksi *</Label>
                      <Input
                        id="pay-ref"
                        required
                        value={payRef}
                        onChange={(e) => setPayRef(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-notes">Catatan</Label>
                      <Input
                        id="pay-notes"
                        placeholder="Pembayaran termin / pelunasan..."
                        value={payNotes}
                        onChange={(e) => setPayNotes(e.target.value)}
                      />
                    </div>
                  </div>

                  {(payInvoice.payments || []).length > 0 && (
                    <div className="border-t border-slate-100 pt-4 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Riwayat Cicilan
                      </div>
                      <div className="space-y-1.5">
                        {(payInvoice.payments || []).map((pm) => (
                          <div
                            key={pm.id}
                            className="flex items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-lg"
                          >
                            <span className="truncate">
                              {pm.paymentMethod} ({pm.referenceNo})
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono font-medium text-[#0B1B3A]">
                                {formatCurrency(pm.amount, pm.currency)}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() =>
                                  openPrintPreview(
                                    buildPaymentReceiptPrintDoc(payInvoice, pm, state.settings),
                                    () => exportPaymentReceiptPdf(payInvoice, pm, state.settings)
                                  )
                                }
                              >
                                <Printer className="h-3 w-3 text-[#0B1B3A]" />
                                Cetak
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => void exportPaymentReceiptPdf(payInvoice, pm, state.settings)}
                              >
                                <Receipt className="h-3 w-3 text-emerald-700" />
                                PDF
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </DialogBody>

                <DialogFooter className="sm:justify-end">
                  <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                    <Button type="button" variant="outline" onClick={() => setPayInvoice(null)}>
                      Batal
                    </Button>
                    <Button type="submit" variant="accent">
                      Simpan Pembayaran &amp; Posting Jurnal
                    </Button>
                  </div>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* MODAL 5: CONFIRM DIALOG (VOID / DELETE)                           */}
      {/* ================================================================= */}
      <Dialog open={!!confirmDialog} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent size="sm">
          {confirmDialog && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>{confirmDialog.title}</DialogTitle>
                <DialogDescription>{confirmDialog.description}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmDialog(null)}>
                  Batal
                </Button>
                <Button
                  type="button"
                  variant={confirmDialog.tone === 'danger' ? 'destructive' : 'gold'}
                  disabled={confirmBusy}
                  onClick={async () => {
                    setConfirmBusy(true);
                    try {
                      await confirmDialog.onConfirm();
                      setConfirmDialog(null);
                    } finally {
                      setConfirmBusy(false);
                    }
                  }}
                >
                  {confirmDialog.confirmLabel}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* MODAL 6: EDIT NOMOR SERI FAKTUR PAJAK (AR INVOICE)                */}
      {/* ================================================================= */}
      <Dialog open={!!taxModalInv} onOpenChange={(open) => !open && setTaxModalInv(null)}>
        <DialogContent size="sm" structured>
          {taxModalInv && (
            <>
              <DialogHeader structured>
                <DialogTitle>Faktur Pajak — {taxModalInv.inv.invoiceNumber}</DialogTitle>
                <DialogDescription>
                  Dicetak pada Invoice Resmi PKP dan direkap di Laporan Rekonsiliasi PPN.
                </DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col flex-1 min-h-0"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await erp.updateInvoiceTaxNumber(taxModalInv.inv.id, taxModalInv.taxNo);
                  if (ok) setTaxModalInv(null);
                }}
              >
                <DialogBody>
                  <div className="space-y-1.5">
                    <Label htmlFor="tax-invoice-number">No. Seri Faktur Pajak (e-Faktur)</Label>
                    <Input
                      id="tax-invoice-number"
                      placeholder="010.004-26.00000123"
                      value={taxModalInv.taxNo}
                      onChange={(e) =>
                        setTaxModalInv((prev) => (prev ? { ...prev, taxNo: e.target.value } : null))
                      }
                    />
                  </div>
                </DialogBody>
                <DialogFooter className="sm:justify-end">
                  <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                    <Button type="button" variant="outline" onClick={() => setTaxModalInv(null)}>
                      Batal
                    </Button>
                    <Button type="submit" variant="accent">
                      Simpan No. Faktur Pajak
                    </Button>
                  </div>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* MODAL 7: RIWAYAT PEMBAYARAN & CETAK KWITANSI PDF                  */}
      {/* ================================================================= */}
      <Dialog open={!!receiptModalInv} onOpenChange={(open) => !open && setReceiptModalInv(null)}>
        <DialogContent size="md" structured>
          {receiptModalInv && (
            <>
              <DialogHeader structured>
                <DialogTitle>Kwitansi Pembayaran — {receiptModalInv.invoiceNumber}</DialogTitle>
                <DialogDescription>
                  {receiptModalInv.counterpartyName} · Total Tagihan{' '}
                  <strong className="font-mono">
                    {formatCurrency(receiptModalInv.totalAmount, receiptModalInv.currency)}
                  </strong>
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="space-y-2">
                  {(receiptModalInv.payments || []).length === 0 ? (
                    <p className="text-xs text-slate-500">Belum ada pembayaran tercatat.</p>
                  ) : (
                    (receiptModalInv.payments || []).map((pm) => (
                      <div
                        key={pm.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-semibold text-[#0B1B3A]">
                            {pm.paymentMethod} · Ref: <span className="font-mono">{pm.referenceNo || '-'}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Tanggal {(pm.paidAt || '').slice(0, 10)} · Nominal{' '}
                            <span className="font-mono font-bold text-emerald-700">
                              {formatCurrency(pm.amount, pm.currency)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              openPrintPreview(
                                buildPaymentReceiptPrintDoc(receiptModalInv, pm, state.settings),
                                () => exportPaymentReceiptPdf(receiptModalInv, pm, state.settings)
                              )
                            }
                          >
                            <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                            Cetak A4
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void exportPaymentReceiptPdf(receiptModalInv, pm, state.settings)}
                          >
                            <Receipt className="h-3.5 w-3.5 text-emerald-700" />
                            PDF
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </DialogBody>
              <DialogFooter className="sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setReceiptModalInv(null)} className="sm:ml-auto">
                  Tutup
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
