import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  NativeSelect,
  StatusLabel,
} from '../components/ui/primitives';
import type { ErpController } from '../controllers/useErpController';
import { useI18n } from '../lib/i18n';
import {
  computeBudgetVsActual,
  computeIncomeStatement,
  computeMonthlyPerformance,
  computeVatReconciliation,
  convertToIdr,
  formatCurrency,
  getAgingBucket,
  getEffectiveTaxRatePercent,
  getTotalProductStock,
  isCompanyPkp,
} from '../models/erpLogic';
import {
  exportIncomeStatementPdf,
  exportMonthlyPerformancePdf,
  exportTableToCsv,
  exportTableToExcel,
  exportTableToPdf,
  exportVatReconciliationPdf,
} from '../services/exportService';

type ReportKind =
  | 'valuation'
  | 'movement'
  | 'purchase'
  | 'sales'
  | 'aging'
  | 'income_statement'
  | 'monthly_performance'
  | 'vat_reconciliation'
  | 'budget_vs_actual';

export function ReportsView({ erp }: { erp: ErpController }) {
  const { state } = erp;
  const { lang, tr } = useI18n();
  const rate = state.settings.defaultExchangeRateUsdIdr;
  const companyIsPkp = isCompanyPkp(state.settings);
  const effectiveTaxRate = getEffectiveTaxRatePercent(state.settings);
  const [activeReport, setActiveReport] = useState<ReportKind>('valuation');
  const [vatMonth, setVatMonth] = useState<string>('ALL');

  const incomeStatement = useMemo(
    () => computeIncomeStatement(state.chartOfAccounts, state.journalEntries),
    [state.chartOfAccounts, state.journalEntries]
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

  const vatMonths = useMemo(() => {
    const set = new Set<string>();
    state.invoices.forEach((inv) => {
      const m = (inv.issueDate || inv.createdAt || '').slice(0, 7);
      if (m.length === 7) set.add(m);
    });
    state.goodsReturns.forEach((ret) => {
      const m = (ret.returnDate || '').slice(0, 7);
      if (m.length === 7) set.add(m);
    });
    return Array.from(set).sort().reverse();
  }, [state.goodsReturns, state.invoices]);

  const vatSummary = useMemo(
    () =>
      computeVatReconciliation(state.invoices, state.goodsReturns, rate, vatMonth, {
        isPkp: companyIsPkp,
        taxRatePercent: effectiveTaxRate,
        orders: [
          ...state.purchaseOrders.map((p) => ({
            id: p.id,
            number: p.poNumber,
            subtotal: p.subtotal,
            taxAmount: p.taxAmount,
          })),
          ...state.salesOrders.map((s) => ({
            id: s.id,
            number: s.soNumber,
            subtotal: s.subtotal,
            taxAmount: s.taxAmount,
          })),
        ],
      }),
    [
      companyIsPkp,
      effectiveTaxRate,
      rate,
      state.goodsReturns,
      state.invoices,
      state.purchaseOrders,
      state.salesOrders,
      vatMonth,
    ]
  );

  const budgetRows = useMemo(
    () => computeBudgetVsActual(state.budgets, monthlyPerformance, lang),
    [lang, monthlyPerformance, state.budgets]
  );

  const valuationRows = state.products
    .filter((p) => !p.isService)
    .map((p) => {
      const qty = getTotalProductStock(p);
      const unitIdr = convertToIdr(p.buyPrice, p.currency, rate);
      const totalVal = qty * unitIdr;
      return {
        SKU: p.sku,
        Produk: p.name,
        Kategori: p.categoryName || '-',
        Satuan: p.uomCode,
        TotalStok: qty,
        HargaBeliIDR: unitIdr,
        NilaiStokIDR: totalVal,
      };
    });

  const movementRows = state.stockMovements.map((m) => ({
    Nomor: m.movementNumber,
    Tipe: m.type,
    SKU: m.productSku || '-',
    Produk: m.productName || '-',
    Gudang: m.warehouseName || '-',
    Delta: m.quantityDelta,
    StokAkhir: m.afterQty,
    Tanggal: (m.createdAt || '').slice(0, 10),
  }));

  const purchaseRows = state.purchaseOrders.map((po) => ({
    NomorPO: po.poNumber,
    Supplier: po.supplierName || '-',
    Gudang: po.warehouseName || '-',
    MataUang: po.currency,
    Total: po.totalAmount,
    EkuivalenIDR: convertToIdr(po.totalAmount, po.currency, po.exchangeRate || rate),
    Status: po.status,
    Tanggal: (po.createdAt || '').slice(0, 10),
  }));

  const salesRows = state.salesOrders.map((so) => ({
    NomorSO: so.soNumber,
    Customer: so.customerName || '-',
    Gudang: so.warehouseName || '-',
    MataUang: so.currency,
    Total: so.totalAmount,
    Status: so.status,
    JatuhTempo: so.dueDate || '-',
  }));

  const agingRows = state.invoices
    .filter((i) => i.balanceDue > 0)
    .map((i) => ({
      Invoice: i.invoiceNumber,
      Tipe: i.ledgerType,
      Partner: i.counterpartyName || '-',
      JatuhTempo: i.dueDate,
      BucketUmur: getAgingBucket(i.dueDate),
      SisaTagihanIDR: convertToIdr(i.balanceDue, i.currency, i.exchangeRate || rate),
      Status: i.status,
    }));

  const incomeStatementRows = [
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
  ];

  const monthlyPerformanceRows = monthlyPerformance.months.map((m) => ({
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
  }));

  const handleExportCsv = () => {
    if (activeReport === 'valuation') {
      exportTableToCsv(
        'DomestiqHub_Stock_Valuation',
        ['SKU', 'Produk', 'Kategori', 'Satuan', 'Total Stok', 'Harga Beli (IDR)', 'Nilai Stok (IDR)'],
        valuationRows.map((r) => [r.SKU, r.Produk, r.Kategori, r.Satuan, r.TotalStok, r.HargaBeliIDR, r.NilaiStokIDR])
      );
    } else if (activeReport === 'movement') {
      exportTableToCsv(
        'DomestiqHub_Inventory_Movement',
        ['Nomor', 'Tipe', 'SKU', 'Produk', 'Gudang', 'Delta', 'Stok Akhir', 'Tanggal'],
        movementRows.map((r) => [r.Nomor, r.Tipe, r.SKU, r.Produk, r.Gudang, r.Delta, r.StokAkhir, r.Tanggal])
      );
    } else if (activeReport === 'purchase') {
      exportTableToCsv(
        'DomestiqHub_Purchase_Report',
        ['Nomor PO', 'Supplier', 'Gudang', 'Mata Uang', 'Total', 'Ekuivalen IDR', 'Status', 'Tanggal'],
        purchaseRows.map((r) => [r.NomorPO, r.Supplier, r.Gudang, r.MataUang, r.Total, r.EkuivalenIDR, r.Status, r.Tanggal])
      );
    } else if (activeReport === 'sales') {
      exportTableToCsv(
        'DomestiqHub_Sales_Report',
        ['Nomor SO', 'Customer', 'Gudang', 'Mata Uang', 'Total', 'Status', 'Jatuh Tempo'],
        salesRows.map((r) => [r.NomorSO, r.Customer, r.Gudang, r.MataUang, r.Total, r.Status, r.JatuhTempo])
      );
    } else if (activeReport === 'aging') {
      exportTableToCsv(
        'DomestiqHub_AP_AR_Aging',
        ['Invoice', 'Tipe', 'Partner', 'Jatuh Tempo', 'Umur', 'Sisa Tagihan (IDR)', 'Status'],
        agingRows.map((r) => [r.Invoice, r.Tipe, r.Partner, r.JatuhTempo, r.BucketUmur, r.SisaTagihanIDR, r.Status])
      );
    } else if (activeReport === 'income_statement') {
      exportTableToCsv(
        'DomestiqHub_Laporan_Laba_Rugi',
        ['Bagian', 'Kode Akun', 'Nama Pos / Akun', 'Nominal (IDR)'],
        incomeStatementRows.map((r) => [r.Bagian, r.KodeAkun, r.NamaAkun, r.NominalIDR])
      );
    } else if (activeReport === 'vat_reconciliation') {
      exportTableToCsv(
        `DomestiqHub_Rekap_PPN_${vatMonth}`,
        ['Tanggal', 'No Dokumen', 'Faktur Pajak', 'Jenis', 'Partner', 'DPP (IDR)', 'PPN (IDR)'],
        vatSummary.details.map((d) => [
          d.date,
          d.docNumber,
          d.taxInvoiceNumber || '-',
          d.type,
          d.counterpartyName,
          d.dppIdr,
          d.vatIdr,
        ])
      );
    } else if (activeReport === 'budget_vs_actual') {
      exportTableToCsv(
        'DomestiqHub_Budget_vs_Actual',
        ['Periode', 'Target Omzet (IDR)', 'Aktual Omzet (IDR)', 'Capaian (%)', 'Max HPP (IDR)', 'Aktual HPP (IDR)', 'Max OpEx (IDR)', 'Aktual OpEx (IDR)', 'Target Laba (IDR)', 'Aktual Laba (IDR)'],
        budgetRows.map((b) => [
          b.monthLabel,
          b.targetRevenueIdr,
          b.actualRevenueIdr,
          Number(b.revenueAttainmentPercent.toFixed(1)),
          b.maxCogsIdr,
          b.actualCogsIdr,
          b.maxOpexIdr,
          b.actualOpexIdr,
          b.targetNetIncomeIdr,
          b.actualNetIncomeIdr,
        ])
      );
    } else {
      exportTableToCsv(
        'DomestiqHub_Performa_Bulanan',
        ['Bulan', 'Omzet (IDR)', 'HPP (IDR)', 'Laba Kotor (IDR)', 'Margin Kotor (%)', 'Beban OpEx (IDR)', 'Laba Bersih (IDR)', 'Jumlah PO', 'Nilai PO (IDR)', 'Jumlah SO', 'Nilai SO (IDR)'],
        monthlyPerformanceRows.map((r) => [
          r.Bulan,
          r.OmzetIDR,
          r.HPPIDR,
          r.LabaKotorIDR,
          r.MarginKotorPersen,
          r.BebanOpExIDR,
          r.LabaBersihIDR,
          r.JumlahPO,
          r.NilaiPOIDR,
          r.JumlahSO,
          r.NilaiSOIDR,
        ])
      );
    }
  };

  const handleExportExcel = () => {
    if (activeReport === 'valuation') {
      exportTableToExcel('Stock_Valuation_Report', 'Stock Valuation', valuationRows);
    } else if (activeReport === 'movement') {
      exportTableToExcel('Inventory_Movement_Report', 'Movements', movementRows);
    } else if (activeReport === 'purchase') {
      exportTableToExcel('Purchase_Report', 'Purchases', purchaseRows);
    } else if (activeReport === 'sales') {
      exportTableToExcel('Sales_Report', 'Sales', salesRows);
    } else if (activeReport === 'aging') {
      exportTableToExcel('AP_AR_Aging_Report', 'Aging', agingRows);
    } else if (activeReport === 'income_statement') {
      exportTableToExcel('Laporan_Laba_Rugi', 'Laba Rugi', incomeStatementRows);
    } else if (activeReport === 'vat_reconciliation') {
      exportTableToExcel(
        `Rekap_PPN_${vatMonth}`,
        'Rekonsiliasi PPN',
        vatSummary.details.map((d) => ({
          Tanggal: d.date,
          NoDokumen: d.docNumber,
          FakturPajak: d.taxInvoiceNumber || '-',
          Jenis: d.type,
          Partner: d.counterpartyName,
          DPP_IDR: d.dppIdr,
          PPN_IDR: d.vatIdr,
        }))
      );
    } else if (activeReport === 'budget_vs_actual') {
      exportTableToExcel(
        'Budget_vs_Actual_Report',
        'Budget vs Actual',
        budgetRows.map((b) => ({
          Periode: b.monthLabel,
          TargetOmzetIDR: b.targetRevenueIdr,
          AktualOmzetIDR: b.actualRevenueIdr,
          CapaianPersen: Number(b.revenueAttainmentPercent.toFixed(1)),
          MaxHPP_IDR: b.maxCogsIdr,
          AktualHPP_IDR: b.actualCogsIdr,
          MaxOpEx_IDR: b.maxOpexIdr,
          AktualOpEx_IDR: b.actualOpexIdr,
          TargetLabaIDR: b.targetNetIncomeIdr,
          AktualLabaIDR: b.actualNetIncomeIdr,
        }))
      );
    } else {
      exportTableToExcel('Performa_Bulanan_Report', 'Performa Bulanan', monthlyPerformanceRows);
    }
  };

  const handleExportPdf = () => {
    if (activeReport === 'income_statement') {
      exportIncomeStatementPdf(incomeStatement, state.settings, 'Semua Periode Berjalan');
      return;
    }
    if (activeReport === 'monthly_performance') {
      exportMonthlyPerformancePdf(monthlyPerformance, state.settings);
      return;
    }
    if (activeReport === 'vat_reconciliation') {
      exportVatReconciliationPdf(vatSummary, state.settings);
      return;
    }

    const configs: Record<
      Exclude<ReportKind, 'income_statement' | 'monthly_performance' | 'vat_reconciliation'>,
      { title: string; headers: string[]; rows: (string | number)[][] }
    > = {
      valuation: {
        title: 'Laporan Valuasi Stok (Stock Valuation Report)',
        headers: ['SKU', 'Produk', 'Kategori', 'Stok', 'Harga Beli (IDR)', 'Total Nilai (IDR)'],
        rows: valuationRows.map((r) => [
          r.SKU,
          r.Produk,
          r.Kategori,
          `${r.TotalStok} ${r.Satuan}`,
          formatCurrency(r.HargaBeliIDR),
          formatCurrency(r.NilaiStokIDR),
        ]),
      },
      movement: {
        title: 'Laporan Pergerakan Inventory',
        headers: ['Nomor', 'Tipe', 'SKU', 'Produk', 'Gudang', 'Delta', 'Stok Akhir', 'Tanggal'],
        rows: movementRows.map((r) => [
          r.Nomor,
          r.Tipe,
          r.SKU,
          r.Produk,
          r.Gudang,
          r.Delta,
          r.StokAkhir,
          r.Tanggal,
        ]),
      },
      purchase: {
        title: 'Laporan Pembelian (Purchase Report)',
        headers: ['No PO', 'Supplier', 'Gudang', 'Curr', 'Total', 'IDR Eqv', 'Status', 'Tanggal'],
        rows: purchaseRows.map((r) => [
          r.NomorPO,
          r.Supplier,
          r.Gudang,
          r.MataUang,
          r.Total,
          formatCurrency(r.EkuivalenIDR),
          r.Status,
          r.Tanggal,
        ]),
      },
      sales: {
        title: 'Laporan Penjualan (Sales Report)',
        headers: ['No SO', 'Customer', 'Gudang', 'Curr', 'Total', 'Status', 'Jatuh Tempo'],
        rows: salesRows.map((r) => [
          r.NomorSO,
          r.Customer,
          r.Gudang,
          r.MataUang,
          formatCurrency(r.Total),
          r.Status,
          r.JatuhTempo,
        ]),
      },
      aging: {
        title: 'Laporan Aging Hutang & Piutang',
        headers: ['Invoice', 'Tipe', 'Partner', 'Jatuh Tempo', 'Umur', 'Sisa (IDR)', 'Status'],
        rows: agingRows.map((r) => [
          r.Invoice,
          r.Tipe,
          r.Partner,
          r.JatuhTempo,
          r.BucketUmur,
          formatCurrency(r.SisaTagihanIDR),
          r.Status,
        ]),
      },
      budget_vs_actual: {
        title: 'Laporan Target & Realisasi Budget Bulanan (Budget vs Actual)',
        headers: ['Periode', 'Target Omzet', 'Aktual Omzet', 'Capaian %', 'Aktual HPP', 'Aktual OpEx', 'Target Laba', 'Aktual Laba'],
        rows: budgetRows.map((b) => [
          b.monthLabel,
          formatCurrency(b.targetRevenueIdr),
          formatCurrency(b.actualRevenueIdr),
          `${b.revenueAttainmentPercent.toFixed(1)}%`,
          formatCurrency(b.actualCogsIdr),
          formatCurrency(b.actualOpexIdr),
          formatCurrency(b.targetNetIncomeIdr),
          formatCurrency(b.actualNetIncomeIdr),
        ]),
      },
    };

    const cfg = configs[activeReport];
    exportTableToPdf({
      filename: `DomestiqHub_${activeReport}_Report`,
      title: cfg.title,
      subtitle: `Dicetak pada ${new Date().toLocaleDateString('id-ID')}`,
      headers: cfg.headers,
      rows: cfg.rows,
      company: state.settings,
      orientation: activeReport === 'budget_vs_actual' ? 'landscape' : 'portrait',
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#0B1B3A]">
            {tr('Pusat Laporan Manajerial', 'Executive Reports Hub')}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            {tr(
              'Valuasi stok, pergerakan barang, pembelian, penjualan, aging, laba rugi, dan performa bulanan (CSV, Excel & PDF).',
              'Stock valuation, warehouse movements, procurement, sales, aging, income statement, and monthly performance (CSV, Excel & PDF).'
            )}
          </p>
        </div>
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="h-4 w-4 text-slate-700" />
            CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExportExcel}>
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            Excel
          </Button>
          <Button type="button" variant="default" size="sm" onClick={handleExportPdf}>
            <FileText className="h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      {/* Report Selector (scrollable on mobile) */}
      <div className="flex flex-nowrap overflow-x-auto no-scrollbar max-w-full sm:flex-wrap items-center gap-1.5 border border-slate-200/80 bg-[#EBF3FA]/70 p-1 rounded-lg sm:w-fit">
        {(
          [
            ['valuation', 'Stock Valuation'],
            ['movement', 'Inventory Movement'],
            ['purchase', 'Purchase Report'],
            ['sales', 'Sales Report'],
            ['aging', 'Hutang & Piutang Aging'],
            ['income_statement', 'Laba Rugi'],
            ['monthly_performance', 'Performa Bulanan'],
            ['vat_reconciliation', companyIsPkp ? 'Rekonsiliasi PPN (PKP)' : 'Rekonsiliasi PPN (Non-PKP)'],
            ['budget_vs_actual', 'Budget vs Realisasi'],
          ] as Array<[ReportKind, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveReport(id)}
            className={`px-3 min-h-[38px] rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors shrink-0 ${
              activeReport === id
                ? 'bg-[#0B1B3A] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#0B1B3A]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeReport === 'vat_reconciliation' && (
        <div className="space-y-3">
          {!companyIsPkp && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900">
              <strong>Status Pajak Perusahaan: Non-PKP (0%).</strong> Perusahaan belum berstatus Pengusaha Kena Pajak (PKP), sehingga PPN Masukan maupun PPN Keluaran bernilai Rp 0. Ubah status ke PKP di menu Sistem &amp; Audit jika perusahaan sudah dikukuhkan sebagai PKP.
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-3.5">
            <div>
              <div className="text-sm font-semibold text-[#0B1B3A]">
                Rekonsiliasi PPN Masukan vs PPN Keluaran ({companyIsPkp ? `PKP ${effectiveTaxRate}%` : 'Non-PKP · 0%'})
              </div>
              <div className="text-xs text-slate-500">
                Otomatis menghitung DPP, PPN Invoice AR/AP, serta koreksi Nota Retur penjualan &amp; pembelian.
              </div>
            </div>
            <NativeSelect
              aria-label="Filter periode PPN"
              value={vatMonth}
              onChange={(e) => setVatMonth(e.target.value)}
              className="w-full sm:w-52"
            >
              <option value="ALL">Semua Periode</option>
              {vatMonths.map((m) => (
                <option key={m} value={m}>
                  Periode {m}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3.5">
                <div className="text-[11px] text-slate-500">PPN Keluaran Netto</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#0B1B3A]">
                  {formatCurrency(vatSummary.netPpnKeluaranIdr)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3.5">
                <div className="text-[11px] text-slate-500">PPN Masukan Netto</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#1B5E99]">
                  {formatCurrency(vatSummary.netPpnMasukanIdr)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3.5">
                <div className="text-[11px] text-slate-500">Koreksi PPN Retur</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-700">
                  {formatCurrency(vatSummary.salesReturnVatIdr + vatSummary.purchaseReturnVatIdr)}
                </div>
              </CardContent>
            </Card>
            <Card className={vatSummary.netVatPayableIdr > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-emerald-200 bg-emerald-50/50'}>
              <CardContent className="p-3.5">
                <div className="text-[11px] font-semibold text-slate-600">
                  Net PPN ({vatSummary.statusLabel})
                </div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#0B1B3A]">
                  {formatCurrency(Math.abs(vatSummary.netVatPayableIdr))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Mobile Card List View for Reports */}
      <div className="space-y-3 md:hidden">
        {activeReport === 'valuation' &&
          valuationRows.map((r) => (
            <Card key={`m_val_${r.SKU}`}>
              <CardContent className="p-4 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-[#0B1B3A]">{r.Produk}</div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {r.SKU} · {r.Kategori}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-[#0B1B3A]">
                    {r.TotalStok} {r.Satuan}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Harga Beli</span>
                    <span className="font-mono tabular-nums">{formatCurrency(r.HargaBeliIDR)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Nilai Valuasi</span>
                    <span className="font-mono font-bold text-[#0B1B3A] tabular-nums">
                      {formatCurrency(r.NilaiStokIDR)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

        {activeReport === 'movement' &&
          movementRows.map((r) => (
            <Card key={`m_rmov_${r.Nomor}`}>
              <CardContent className="p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[#0B1B3A]">{r.Nomor}</span>
                  <span className="font-mono text-[11px] text-slate-500">{r.Tanggal}</span>
                </div>
                <div className="font-medium text-slate-800">{r.Produk}</div>
                <div className="flex items-center justify-between text-[11px] bg-[#F4F7FB] rounded-lg p-2.5">
                  <span>{r.Tipe} · {r.Gudang}</span>
                  <span className="font-mono font-bold text-[#0B1B3A]">Delta: {r.Delta}</span>
                </div>
              </CardContent>
            </Card>
          ))}

        {activeReport === 'purchase' &&
          purchaseRows.map((r) => (
            <Card key={`m_rpo_${r.NomorPO}`}>
              <CardContent className="p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[#0B1B3A]">{r.NomorPO}</span>
                  <span className="text-[11px] font-medium text-[#1B5E99]">{r.Status}</span>
                </div>
                <div className="font-medium text-slate-800">{r.Supplier}</div>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Total Asli</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(r.Total, r.MataUang as 'IDR' | 'USD')}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Ekuivalen IDR</span>
                    <span className="font-mono font-bold text-[#0B1B3A] tabular-nums">
                      {formatCurrency(r.EkuivalenIDR)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

        {activeReport === 'sales' &&
          salesRows.map((r) => (
            <Card key={`m_rso_${r.NomorSO}`}>
              <CardContent className="p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[#0B1B3A]">{r.NomorSO}</span>
                  <span className="text-[11px] font-medium text-[#1B5E99]">{r.Status}</span>
                </div>
                <div className="font-medium text-slate-800">{r.Customer}</div>
                <div className="flex items-center justify-between rounded-lg bg-[#F4F7FB] p-2.5">
                  <span className="text-[11px] text-slate-500">{r.Gudang}</span>
                  <span className="font-mono font-bold text-[#0B1B3A] tabular-nums">
                    {formatCurrency(r.Total, r.MataUang as 'IDR' | 'USD')}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}

        {activeReport === 'aging' &&
          agingRows.map((r) => (
            <Card key={`m_rag_${r.Invoice}`}>
              <CardContent className="p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[#0B1B3A]">
                    {r.Invoice} ({r.Tipe})
                  </span>
                  <span className="text-[11px] font-semibold text-amber-700">{r.BucketUmur}</span>
                </div>
                <div className="font-medium text-slate-800">{r.Partner}</div>
                <div className="flex items-center justify-between rounded-lg bg-[#F4F7FB] p-2.5">
                  <span className="text-[11px] text-slate-500">Jatuh Tempo: {r.JatuhTempo}</span>
                  <span className="font-mono font-bold text-[#0B1B3A] tabular-nums">
                    {formatCurrency(r.SisaTagihanIDR)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}

        {activeReport === 'income_statement' && (
          <Card>
            <CardContent className="p-0 divide-y divide-slate-100 text-xs">
              {incomeStatementRows.map((r, idx) => {
                const isSummary = r.Bagian === 'Ringkasan';
                const isSubtotal = r.Bagian === 'Subtotal';
                return (
                  <div
                    key={`m_is_${idx}`}
                    className={`px-4 py-3 flex items-center justify-between gap-2 ${
                      isSummary
                        ? 'bg-[#0B1B3A] text-white font-bold'
                        : isSubtotal
                        ? 'bg-[#EBF3FA]/70 font-semibold text-[#0B1B3A]'
                        : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate">{r.NamaAkun}</div>
                      <div
                        className={`text-[10px] ${
                          isSummary ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {r.Bagian} {r.KodeAkun !== '-' ? `· ${r.KodeAkun}` : ''}
                      </div>
                    </div>
                    <span
                      className={`font-mono tabular-nums font-semibold shrink-0 ${
                        isSummary ? 'text-[#D9AA32]' : ''
                      }`}
                    >
                      {formatCurrency(r.NominalIDR)}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {activeReport === 'monthly_performance' && (
          <div className="space-y-3">
            {monthlyPerformance.months.map((m) => (
              <Card key={`m_mp_${m.monthKey}`}>
                <CardContent className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#0B1B3A] text-sm">{m.monthLabel}</span>
                    <span className="font-mono font-semibold text-emerald-700">
                      Margin {m.grossMarginPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Omzet</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatCurrency(m.revenueIdr)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">Laba Bersih</span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          m.netIncomeIdr >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {formatCurrency(m.netIncomeIdr)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Nilai PO</span>
                      <span className="font-mono tabular-nums">{formatCurrency(m.poTotalIdr)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">Nilai SO</span>
                      <span className="font-mono tabular-nums">{formatCurrency(m.soTotalIdr)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {activeReport === 'vat_reconciliation' && (
          <div className="space-y-3">
            {vatSummary.details.map((d) => (
              <Card key={`m_vat_${d.id}`}>
                <CardContent className="p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#0B1B3A]">{d.docNumber}</span>
                    <StatusLabel
                      status={d.type}
                      tone={
                        d.type === 'PPN_KELUARAN'
                          ? 'warning'
                          : d.type === 'PPN_MASUKAN'
                          ? 'info'
                          : 'neutral'
                      }
                    />
                  </div>
                  <div className="font-medium text-slate-800">{d.counterpartyName}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {d.date} · FP: {d.taxInvoiceNumber || '-'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                    <div>
                      <span className="text-[10px] text-slate-500 block">DPP</span>
                      <span className="font-mono tabular-nums">{formatCurrency(d.dppIdr)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">
                        PPN ({companyIsPkp ? `${effectiveTaxRate}%` : 'Non-PKP 0%'})
                      </span>
                      <span className="font-mono font-bold text-[#0B1B3A] tabular-nums">
                        {formatCurrency(d.vatIdr)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {activeReport === 'budget_vs_actual' && (
          <div className="space-y-3">
            {budgetRows.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada data target budget bulanan. Atur melalui Akunting → Tutup Buku &amp; Budget.
                </CardContent>
              </Card>
            ) : (
              budgetRows.map((b) => (
                <Card key={`m_bdg_${b.periodKey}`}>
                  <CardContent className="p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#0B1B3A] text-sm">{b.monthLabel}</span>
                      <StatusLabel
                        status={`${b.revenueAttainmentPercent.toFixed(1)}% Omzet`}
                        tone={b.revenueAttainmentPercent >= 90 ? 'success' : 'warning'}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Target / Aktual Omzet</span>
                        <span className="font-mono font-semibold text-[#0B1B3A]">
                          {formatCurrency(b.actualRevenueIdr)} / {formatCurrency(b.targetRevenueIdr)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Target / Aktual Laba</span>
                        <span className="font-mono font-bold text-emerald-700">
                          {formatCurrency(b.actualNetIncomeIdr)} / {formatCurrency(b.targetNetIncomeIdr)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>

      {/* Desktop Report Table */}
      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle>
            {activeReport === 'valuation' && 'Stock Valuation Report'}
            {activeReport === 'movement' && 'Inventory Movement Report'}
            {activeReport === 'purchase' && 'Purchase Report'}
            {activeReport === 'sales' && 'Sales Report'}
            {activeReport === 'aging' && 'Hutang & Piutang Aging Report'}
            {activeReport === 'income_statement' && 'Laporan Laba Rugi (Income Statement)'}
            {activeReport === 'monthly_performance' && 'Laporan Performa Bulanan (Monthly Performance)'}
            {activeReport === 'vat_reconciliation' &&
              `Laporan Rekonsiliasi PPN Masukan vs Keluaran (${companyIsPkp ? `PKP ${effectiveTaxRate}%` : 'Non-PKP 0%'})`}
            {activeReport === 'budget_vs_actual' && 'Laporan Target & Realisasi Budget Bulanan (Budget vs Actual)'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {activeReport === 'valuation' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">SKU</th>
                    <th className="py-3 px-3">Produk</th>
                    <th className="py-3 px-3">Kategori</th>
                    <th className="py-3 px-3 text-right">Total Stok</th>
                    <th className="py-3 px-3 text-right">Harga Beli (IDR)</th>
                    <th className="py-3 px-4 text-right">Nilai Valuasi (IDR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {valuationRows.map((r) => (
                    <tr key={r.SKU}>
                      <td className="py-2.5 px-4 font-mono">{r.SKU}</td>
                      <td className="py-2.5 px-3 font-medium">{r.Produk}</td>
                      <td className="py-2.5 px-3 text-slate-500">{r.Kategori}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {r.TotalStok} {r.Satuan}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatCurrency(r.HargaBeliIDR)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                        {formatCurrency(r.NilaiStokIDR)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === 'movement' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Nomor</th>
                    <th className="py-3 px-3">Tipe</th>
                    <th className="py-3 px-3">Produk</th>
                    <th className="py-3 px-3">Gudang</th>
                    <th className="py-3 px-3 text-right">Delta</th>
                    <th className="py-3 px-4 text-right">Tanggal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movementRows.map((r) => (
                    <tr key={r.Nomor}>
                      <td className="py-2.5 px-4 font-mono">{r.Nomor}</td>
                      <td className="py-2.5 px-3">{r.Tipe}</td>
                      <td className="py-2.5 px-3 font-medium">{r.Produk}</td>
                      <td className="py-2.5 px-3">{r.Gudang}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{r.Delta}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.Tanggal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === 'purchase' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">No. PO</th>
                    <th className="py-3 px-3">Supplier</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Total Asli</th>
                    <th className="py-3 px-4 text-right">Ekuivalen IDR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseRows.map((r) => (
                    <tr key={r.NomorPO}>
                      <td className="py-2.5 px-4 font-mono font-semibold">{r.NomorPO}</td>
                      <td className="py-2.5 px-3">{r.Supplier}</td>
                      <td className="py-2.5 px-3">{r.Status}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatCurrency(r.Total, r.MataUang as 'IDR' | 'USD')}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                        {formatCurrency(r.EkuivalenIDR)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === 'sales' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">No. SO</th>
                    <th className="py-3 px-3">Customer</th>
                    <th className="py-3 px-3">Gudang</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4 text-right">Nilai Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salesRows.map((r) => (
                    <tr key={r.NomorSO}>
                      <td className="py-2.5 px-4 font-mono font-semibold">{r.NomorSO}</td>
                      <td className="py-2.5 px-3">{r.Customer}</td>
                      <td className="py-2.5 px-3">{r.Gudang}</td>
                      <td className="py-2.5 px-3">{r.Status}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                        {formatCurrency(r.Total, r.MataUang as 'IDR' | 'USD')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === 'aging' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Invoice</th>
                    <th className="py-3 px-3">Jenis</th>
                    <th className="py-3 px-3">Partner</th>
                    <th className="py-3 px-3">Jatuh Tempo</th>
                    <th className="py-3 px-3">Umur</th>
                    <th className="py-3 px-4 text-right">Sisa (IDR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {agingRows.map((r) => (
                    <tr key={r.Invoice}>
                      <td className="py-2.5 px-4 font-mono font-semibold">{r.Invoice}</td>
                      <td className="py-2.5 px-3 font-mono">{r.Tipe}</td>
                      <td className="py-2.5 px-3">{r.Partner}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">{r.JatuhTempo}</td>
                      <td className="py-2.5 px-3">{r.BucketUmur}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                        {formatCurrency(r.SisaTagihanIDR)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === 'income_statement' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Bagian</th>
                    <th className="py-3 px-3">Kode Akun</th>
                    <th className="py-3 px-3">Pos Akun / Keterangan</th>
                    <th className="py-3 px-4 text-right">Nominal (IDR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incomeStatementRows.map((r, idx) => {
                    const isSummary = r.Bagian === 'Ringkasan';
                    const isSubtotal = r.Bagian === 'Subtotal';
                    return (
                      <tr
                        key={`${r.Bagian}-${r.KodeAkun}-${idx}`}
                        className={
                          isSummary
                            ? 'bg-[#0B1B3A] text-white font-bold'
                            : isSubtotal
                            ? 'bg-[#EBF3FA]/70 font-semibold text-[#0B1B3A]'
                            : ''
                        }
                      >
                        <td className="py-2.5 px-4">{r.Bagian}</td>
                        <td className="py-2.5 px-3 font-mono">{r.KodeAkun}</td>
                        <td className="py-2.5 px-3">{r.NamaAkun}</td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                            isSummary ? 'text-[#D9AA32]' : ''
                          }`}
                        >
                          {formatCurrency(r.NominalIDR)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {activeReport === 'monthly_performance' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Bulan</th>
                    <th className="py-3 px-3 text-right">Omzet (IDR)</th>
                    <th className="py-3 px-3 text-right">HPP (IDR)</th>
                    <th className="py-3 px-3 text-right">Laba Kotor</th>
                    <th className="py-3 px-3 text-right">Margin %</th>
                    <th className="py-3 px-3 text-right">Beban OpEx</th>
                    <th className="py-3 px-3 text-right">Laba Bersih</th>
                    <th className="py-3 px-3 text-right">Nilai PO</th>
                    <th className="py-3 px-4 text-right">Nilai SO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlyPerformance.months.map((m) => (
                    <tr key={m.monthKey} className="hover:bg-[#F4F7FB]">
                      <td className="py-2.5 px-4 font-semibold text-[#0B1B3A]">{m.monthLabel}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatCurrency(m.revenueIdr)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        {formatCurrency(m.cogsIdr)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
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
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatCurrency(m.poTotalIdr)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {formatCurrency(m.soTotalIdr)}
                      </td>
                    </tr>
                  ))}
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
            )}

            {activeReport === 'vat_reconciliation' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-3">No. Dokumen</th>
                    <th className="py-3 px-3">No. Faktur Pajak</th>
                    <th className="py-3 px-3">Jenis</th>
                    <th className="py-3 px-3">Partner</th>
                    <th className="py-3 px-3 text-right">DPP (IDR)</th>
                    <th className="py-3 px-4 text-right">
                      PPN {companyIsPkp ? `${effectiveTaxRate}%` : '(Non-PKP 0%)'} (IDR)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vatSummary.details.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        Belum ada dokumen pajak pada periode yang dipilih.
                      </td>
                    </tr>
                  ) : (
                    vatSummary.details.map((d) => (
                      <tr key={d.id} className="hover:bg-[#F4F7FB]">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">{d.date}</td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-[#0B1B3A]">{d.docNumber}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{d.taxInvoiceNumber || '-'}</td>
                        <td className="py-2.5 px-3">
                          <StatusLabel
                            status={d.type}
                            tone={
                              d.type === 'PPN_KELUARAN'
                                ? 'warning'
                                : d.type === 'PPN_MASUKAN'
                                ? 'info'
                                : 'neutral'
                            }
                          />
                        </td>
                        <td className="py-2.5 px-3">{d.counterpartyName}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatCurrency(d.dppIdr)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                          {formatCurrency(d.vatIdr)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeReport === 'budget_vs_actual' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Periode</th>
                    <th className="py-3 px-3 text-right">Target Omzet</th>
                    <th className="py-3 px-3 text-right">Aktual Omzet</th>
                    <th className="py-3 px-3 text-right">Capaian %</th>
                    <th className="py-3 px-3 text-right">Max / Aktual HPP</th>
                    <th className="py-3 px-3 text-right">Max / Aktual OpEx</th>
                    <th className="py-3 px-3 text-right">Target Laba</th>
                    <th className="py-3 px-4 text-right">Aktual Laba</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {budgetRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        Belum ada target budget bulanan yang ditetapkan.
                      </td>
                    </tr>
                  ) : (
                    budgetRows.map((b) => (
                      <tr key={b.periodKey} className="hover:bg-[#F4F7FB]">
                        <td className="py-2.5 px-4 font-semibold text-[#0B1B3A]">{b.monthLabel}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatCurrency(b.targetRevenueIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#154C7E]">
                          {formatCurrency(b.actualRevenueIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold">
                          {b.revenueAttainmentPercent.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {formatCurrency(b.actualCogsIdr)} / {formatCurrency(b.maxCogsIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {formatCurrency(b.actualOpexIdr)} / {formatCurrency(b.maxOpexIdr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatCurrency(b.targetNetIncomeIdr)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold ${
                            b.actualNetIncomeIdr >= b.targetNetIncomeIdr ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {formatCurrency(b.actualNetIncomeIdr)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
