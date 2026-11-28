import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import {
  formatCurrency,
  getEffectiveTaxRatePercent,
  isCompanyPkp,
  type ExecutiveRankItem,
  type IncomeStatementSummary,
  type MonthlyPerformanceSummary,
  type VatReconciliationSummary,
} from '../models/erpLogic';
import {
  buildOrderTermsSummaryForPo,
  buildOrderTermsSummaryForQuotation,
  buildOrderTermsSummaryForSo,
  resolvePaymentTermDisplay,
  type OrderTermsSectionSummary,
} from '../models/orderTerms';
import { formatPartnerRegistrationNumber } from '../models/printDocumentModel';
import type {
  AccountingInvoice,
  CompanySettings,
  Customer,
  InvoicePayment,
  PurchaseOrder,
  SalesOrder,
  SalesQuotation,
  StockMovement,
  Supplier,
  Warehouse,
} from '../models/types';

async function generateQrDataUrl(payload: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(payload, {
      margin: 1,
      width: 160,
      color: { dark: '#0B1B3A', light: '#FFFFFF' },
    });
  } catch {
    return null;
  }
}

export function terbilangId(n: number): string {
  const num = Math.round(Math.abs(n));
  if (num === 0) return 'Nol Rupiah';
  const satuan = [
    '',
    'Satu',
    'Dua',
    'Tiga',
    'Empat',
    'Lima',
    'Enam',
    'Tujuh',
    'Delapan',
    'Sembilan',
    'Sepuluh',
    'Sebelas',
  ];
  const convert = (val: number): string => {
    if (val < 12) return satuan[val];
    if (val < 20) return `${satuan[val - 10]} Belas`;
    if (val < 100) return `${satuan[Math.floor(val / 10)]} Puluh ${convert(val % 10)}`.trim();
    if (val < 200) return `Seratus ${convert(val - 100)}`.trim();
    if (val < 1000) return `${satuan[Math.floor(val / 100)]} Ratus ${convert(val % 100)}`.trim();
    if (val < 2000) return `Seribu ${convert(val - 1000)}`.trim();
    if (val < 1_000_000) return `${convert(Math.floor(val / 1000))} Ribu ${convert(val % 1000)}`.trim();
    if (val < 1_000_000_000)
      return `${convert(Math.floor(val / 1_000_000))} Juta ${convert(val % 1_000_000)}`.trim();
    if (val < 1_000_000_000_000)
      return `${convert(Math.floor(val / 1_000_000_000))} Miliar ${convert(val % 1_000_000_000)}`.trim();
    return `${convert(Math.floor(val / 1_000_000_000_000))} Triliun ${convert(val % 1_000_000_000_000)}`.trim();
  };
  return `${convert(num).replace(/\s+/g, ' ').trim()} Rupiah`;
}

function escapeCsvCell(val: string | number | undefined | null): string {
  const s = val === undefined || val === null ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportTableToCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTableToExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, string | number>[]
): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet').slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

interface PdfMetadataRow {
  label: string;
  value: string;
}

interface PdfBottomQrMeta {
  qrDataUrl: string | null;
  code: string;
  title: string;
  detailLine: string;
}

function getLastAutoTableFinalY(doc: jsPDF, fallbackY: number): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallbackY;
}

/**
 * Corporate PDF Header Banner (standardized proportions, non-oversized fonts)
 */
function drawCorporateBanner(
  doc: jsPDF,
  company: CompanySettings,
  documentTitle: string,
  docBadge?: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  // Top navy bar (21.5mm) + subtle gold accent (0.8mm)
  doc.setFillColor(11, 27, 58);
  doc.rect(0, 0, pageWidth, 21.5, 'F');
  doc.setFillColor(217, 170, 50);
  doc.rect(0, 21.5, pageWidth, 0.8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(255, 255, 255);
  doc.text(company.companyName || 'PT Domestiq Hub Indonesia', margin, 8.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(226, 232, 240);
  const addrText = doc.splitTextToSize(company.address || 'Jakarta, Indonesia', pageWidth - 78);
  doc.text(addrText[0] || '', margin, 13.6);
  doc.text(
    `NPWP: ${company.npwp || '-'}  |  Telp: ${company.phone || '-'}  |  Email: ${company.email || '-'}`,
    margin,
    18.2
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Dicetak: ${new Date().toLocaleDateString('id-ID')}`, pageWidth - margin, 8.8, {
    align: 'right',
  });

  // Document Title Strip
  const titleBarY = 25;
  doc.setFillColor(244, 247, 251);
  doc.setDrawColor(216, 226, 239);
  doc.roundedRect(margin, titleBarY, pageWidth - margin * 2, 8.5, 1.2, 1.2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(11, 27, 58);
  doc.text(documentTitle, margin + 3.5, titleBarY + 5.7);

  if (docBadge) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(27, 94, 153);
    doc.text(docBadge, pageWidth - margin - 3.5, titleBarY + 5.7, { align: 'right' });
  }

  doc.setFont('helvetica', 'normal');
  return titleBarY + 12.5;
}

/**
 * Perfectly vertical-aligned two-column Key : Value metadata grid.
 * Prevents crooked/diagonal colons and text collisions regardless of wrapping.
 */
function drawAlignedMetadataGrid(
  doc: jsPDF,
  startY: number,
  leftRows: PdfMetadataRow[],
  rightRows: PdfMetadataRow[]
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const colGap = 6;
  const colWidth = (pageWidth - margin * 2 - colGap) / 2;
  const labelWidth = 27.5;
  const colonXOffset = 28.5;
  const valueXOffset = 31;
  const valueMaxWidth = colWidth - valueXOffset - 2;
  const lineH = 3.9;
  const rowGap = 1.4;

  const renderColumn = (colX: number, rows: PdfMetadataRow[]): number => {
    let y = startY + 3.8;
    for (const row of rows) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      const labelLines = doc.splitTextToSize(row.label, labelWidth);
      doc.text(labelLines[0] || row.label, colX + 2, y);

      // Fixed aligned colon
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text(':', colX + colonXOffset, y);

      // Wrapped value cleanly aligned to value column
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      const valText = (row.value || '-').trim() || '-';
      const valLines: string[] = doc.splitTextToSize(valText, valueMaxWidth);
      doc.text(valLines, colX + valueXOffset, y);

      y += Math.max(1, valLines.length) * lineH + rowGap;
    }
    return y;
  };

  const leftEndY = renderColumn(margin, leftRows);
  const rightEndY = renderColumn(margin + colWidth + colGap, rightRows);
  const blockEndY = Math.max(leftEndY, rightEndY) + 1.5;

  // Subtle horizontal divider separating metadata from line-item table
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, blockEndY, pageWidth - margin, blockEndY);
  doc.setFont('helvetica', 'normal');

  return blockEndY + 3.5;
}

/**
 * Ensures enough space remains above the bottom QR strip + page footer.
 */
function ensureSpaceForBlock(
  doc: jsPDF,
  currentY: number,
  neededMm: number,
  company: CompanySettings,
  documentTitle: string,
  docBadge?: string,
  bottomReserveMm: number = 38
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (currentY + neededMm > pageHeight - bottomReserveMm) {
    doc.addPage();
    return drawCorporateBanner(doc, company, documentTitle, docBadge) + 2;
  }
  return currentY;
}

interface PdfTotalBoxRow {
  label: string;
  value: string;
  isGrandTotal?: boolean;
}

/**
 * Draws side-by-side bottom-left Terms & Conditions card and bottom-right Totals card
 * with overflow protection against the bottom QR verification dock.
 */
function drawBottomTermsAndTotalsPdf(
  doc: jsPDF,
  startY: number,
  termsSummary: OrderTermsSectionSummary,
  totalRows: PdfTotalBoxRow[],
  company: CompanySettings,
  documentTitle: string,
  docBadge: string
): number {
  const leftX = 14;
  const leftW = 98;
  const innerW = leftW - 7;
  const labelW = 24;
  const valW = leftW - labelW - 11;

  // Measure left box height before drawing
  let measureH = 6.5; // header
  doc.setFontSize(7.2);
  const measuredMeta = termsSummary.metaRows.map((row) => {
    const valLines = doc.splitTextToSize((row.value || '-').trim() || '-', valW) as string[];
    const h = Math.max(1, valLines.length) * 3.4 + 0.9;
    measureH += h;
    return { label: row.label, valLines, h };
  });
  measureH += 2; // divider spacing

  doc.setFontSize(6.9);
  const noticeLines = termsSummary.mandatoryNotice
    ? (doc.splitTextToSize(`Catatan Wajib: ${termsSummary.mandatoryNotice}`, innerW - 4) as string[])
    : [];
  const noticeBoxH = noticeLines.length > 0 ? noticeLines.length * 3.2 + 3.2 : 0;
  if (noticeBoxH > 0) {
    measureH += noticeBoxH + 2.2;
  }

  doc.setFontSize(6.8);
  const termsLines = doc.splitTextToSize(termsSummary.termsText || '-', innerW) as string[];
  measureH += Math.max(1, termsLines.length) * 3.15 + 1.8;

  const extraLines = termsSummary.additionalNotes
    ? (doc.splitTextToSize(`Catatan Tambahan: ${termsSummary.additionalNotes}`, innerW) as string[])
    : [];
  if (extraLines.length > 0) {
    measureH += 2.2 + extraLines.length * 3.15;
  }
  measureH += 2.5;

  const rightH = Math.max(22, totalRows.length * 5.6 + 6);
  const blockH = Math.max(measureH, rightH);

  const y = ensureSpaceForBlock(doc, startY, blockH + 4, company, documentTitle, docBadge);

  // Draw Left Box: Terms & Conditions
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(216, 226, 239);
  doc.setLineWidth(0.3);
  doc.roundedRect(leftX, y, leftW, blockH, 1.2, 1.2, 'FD');

  let curY = y + 4.8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(11, 27, 58);
  doc.text('TERMS & CONDITIONS', leftX + 3.5, curY);
  curY += 4.2;

  for (const m of measuredMeta) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.setTextColor(71, 85, 105);
    doc.text(m.label, leftX + 3.5, curY);
    doc.setFont('helvetica', 'bold');
    doc.text(':', leftX + 27.5, curY);
    doc.setTextColor(15, 23, 42);
    doc.text(m.valLines, leftX + 29.8, curY);
    curY += m.h;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(leftX + 3.5, curY - 0.3, leftX + leftW - 3.5, curY - 0.3);
  curY += 2.6;

  if (noticeLines.length > 0) {
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(245, 158, 11);
    doc.roundedRect(leftX + 3.2, curY - 2.3, leftW - 6.4, noticeBoxH, 0.8, 0.8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(120, 53, 15);
    doc.text(noticeLines, leftX + 4.8, curY + 0.8);
    curY += noticeBoxH + 1.6;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(30, 41, 59);
  doc.text(termsLines, leftX + 3.5, curY);
  curY += Math.max(1, termsLines.length) * 3.15 + 1.5;

  if (extraLines.length > 0) {
    doc.setDrawColor(203, 213, 225);
    doc.line(leftX + 3.5, curY - 0.6, leftX + leftW - 3.5, curY - 0.6);
    curY += 2.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.7);
    doc.setTextColor(51, 65, 85);
    doc.text(extraLines, leftX + 3.5, curY);
  }

  // Draw Right Box: Totals Summary (aligned horizontally at exact same Y)
  const rightX = 116;
  const rightW = 80;
  doc.setFillColor(244, 247, 251);
  doc.setDrawColor(216, 226, 239);
  doc.roundedRect(rightX, y, rightW, rightH, 1.2, 1.2, 'FD');

  let totY = y + 5.5;
  totalRows.forEach((row, idx) => {
    const isGrand = Boolean(row.isGrandTotal || idx === totalRows.length - 1);
    if (isGrand && idx > 0) {
      doc.setDrawColor(203, 213, 225);
      doc.line(rightX + 3.5, totY - 2.4, rightX + rightW - 3.5, totY - 2.4);
      totY += 1.2;
    }
    doc.setFont('helvetica', isGrand ? 'bold' : 'normal');
    doc.setFontSize(isGrand ? 8.6 : 7.8);
    doc.setTextColor(isGrand ? 11 : 71, isGrand ? 27 : 85, isGrand ? 58 : 105);
    doc.text(row.label, rightX + 3.5, totY);
    doc.text(':', rightX + 31.5, totY);
    doc.setTextColor(15, 23, 42);
    doc.text(row.value, rightX + rightW - 3.5, totY, { align: 'right' });
    totY += 5.4;
  });

  return y + blockH;
}

/**
 * Draws standardized corporate footers ("Halaman X dari Y") on every page,
 * plus an optional bottom-anchored QR digital verification block strictly at the bottom of the final page.
 */
function finalizePdfWithFootersAndBottomQr(
  doc: jsPDF,
  company: CompanySettings,
  contentEndY: number,
  bottomQr?: PdfBottomQrMeta,
  documentTitleForContinuation?: string,
  docBadge?: string
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  if (bottomQr) {
    const qrBoxH = 21;
    const footerLineY = pageHeight - 11.5;
    const qrBoxY = footerLineY - qrBoxH - 2.5; // strictly at bottom just above footer

    // If final content overlapped the bottom QR strip zone, push verification strip cleanly onto a fresh page bottom
    if (contentEndY > qrBoxY - 3) {
      doc.addPage();
      if (documentTitleForContinuation) {
        drawCorporateBanner(doc, company, documentTitleForContinuation, docBadge);
      }
    }

    const totalPagesAfterCheck = doc.getNumberOfPages();
    doc.setPage(totalPagesAfterCheck);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, qrBoxY, pageWidth - margin * 2, qrBoxH, 1.4, 1.4, 'FD');

    if (bottomQr.qrDataUrl) {
      doc.addImage(bottomQr.qrDataUrl, 'PNG', margin + 2.5, qrBoxY + 2, 17, 17);
    }

    const textStartX = bottomQr.qrDataUrl ? margin + 23 : margin + 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(11, 27, 58);
    doc.text(bottomQr.title, textStartX, qrBoxY + 6.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(27, 94, 153);
    doc.text(`Kode Validasi : ${bottomQr.code}`, textStartX, qrBoxY + 11.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.setTextColor(71, 85, 105);
    const detailLines = doc.splitTextToSize(bottomQr.detailLine, pageWidth - textStartX - margin - 4);
    doc.text(detailLines.slice(0, 2), textStartX, qrBoxY + 15.8);
  }

  const totalPages = doc.getNumberOfPages();
  const printedAt = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerLineY = pageHeight - 11.5;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.line(margin, footerLineY, pageWidth - margin, footerLineY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${company.companyName || 'PT Domestiq Hub Indonesia'}  |  NPWP: ${company.npwp || '-'}`,
      margin,
      footerLineY + 4.5
    );
    doc.text(`Dicetak: ${printedAt}`, pageWidth / 2, footerLineY + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(51, 65, 85);
    doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - margin, footerLineY + 4.5, {
      align: 'right',
    });
  }
}

export function exportTableToPdf(params: {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  company?: CompanySettings;
  orientation?: 'landscape' | 'portrait';
}): void {
  const doc = new jsPDF({
    orientation: params.orientation || 'landscape',
    unit: 'mm',
    format: 'a4',
  });
  const company: CompanySettings = params.company || {
    id: 'company',
    companyName: 'PT Domestiq Hub Indonesia',
    tagline: 'Internal Procurement, Inventory & Accounting System',
    address: 'Jakarta, Indonesia',
    phone: '-',
    email: '-',
    npwp: '-',
    bankName: 'Bank Mandiri (KCP Sunter Danau)',
    bankAccountNumber: '120-0088-771290-8',
    bankAccountHolder: 'PT Domestiq Hub Indonesia',
    managerApprovalLimitIdr: 25000000,
    defaultExchangeRateUsdIdr: 16200,
    isPkp: false,
    taxRatePercent: 11,
    updatedBy: '',
    updatedAt: '',
  };

  let nextY = drawCorporateBanner(doc, company, params.title.toUpperCase());
  if (params.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(params.subtitle, 14, nextY + 1);
    nextY += 6;
  }

  autoTable(doc, {
    startY: nextY,
    margin: { left: 14, right: 14, bottom: 16 },
    head: [params.headers],
    body: params.rows.map((r) => r.map((c) => String(c))),
    styles: { fontSize: 7.8, cellPadding: 2.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 7.8 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
  });

  finalizePdfWithFootersAndBottomQr(doc, company, getLastAutoTableFinalY(doc, nextY));
  doc.save(`${params.filename}.pdf`);
}

export function exportIncomeStatementPdf(
  summary: IncomeStatementSummary,
  company: CompanySettings,
  periodLabel: string
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startMetaY = drawCorporateBanner(
    doc,
    company,
    'LAPORAN LABA RUGI (INCOME STATEMENT)',
    periodLabel
  );

  const tableStartY = drawAlignedMetadataGrid(
    doc,
    startMetaY,
    [{ label: 'Periode Laporan', value: periodLabel }],
    [{ label: 'Mata Uang Pelaporan', value: 'IDR (Rupiah Indonesia)' }]
  );

  const rows: string[][] = [
    ['PENDAPATAN USAHA', '', ''],
    ...summary.revenues.map((r) => [r.code, r.name, formatCurrency(r.amountIdr, 'IDR')]),
    ['', 'Total Pendapatan Usaha', formatCurrency(summary.totalRevenueIdr, 'IDR')],
    ['HARGA POKOK PENJUALAN (HPP)', '', ''],
    ...summary.cogs.map((r) => [r.code, r.name, formatCurrency(r.amountIdr, 'IDR')]),
    ['', 'Laba Kotor (Gross Profit)', formatCurrency(summary.grossProfitIdr, 'IDR')],
    ['BEBAN OPERASIONAL', '', ''],
    ...summary.expenses.map((r) => [r.code, r.name, formatCurrency(r.amountIdr, 'IDR')]),
    ['', 'Total Beban Operasional', formatCurrency(summary.totalExpensesIdr, 'IDR')],
    ['', 'LABA BERSIH PERIODE BERJALAN', formatCurrency(summary.netIncomeIdr, 'IDR')],
  ];

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 18 },
    head: [['Kode', 'Pos Akun / Keterangan', 'Nominal (IDR)']],
    body: rows,
    styles: { fontSize: 8.2, cellPadding: 2.5, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8.2 },
    columnStyles: {
      0: { cellWidth: 26 },
      2: { halign: 'right', cellWidth: 46 },
    },
    didParseCell: (data) => {
      const rawRow = Array.isArray(data.row.raw) ? data.row.raw : [];
      const section = String(rawRow[0] ?? '');
      const label = String(rawRow[1] ?? '');
      if (
        section === 'PENDAPATAN USAHA' ||
        section === 'HARGA POKOK PENJUALAN (HPP)' ||
        section === 'BEBAN OPERASIONAL'
      ) {
        data.cell.styles.fillColor = [235, 243, 250];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [11, 27, 58];
      } else if (
        label === 'Total Pendapatan Usaha' ||
        label === 'Laba Kotor (Gross Profit)' ||
        label === 'Total Beban Operasional'
      ) {
        data.cell.styles.fillColor = [248, 250, 252];
        data.cell.styles.fontStyle = 'bold';
      } else if (label === 'LABA BERSIH PERIODE BERJALAN') {
        data.cell.styles.fillColor = [11, 27, 58];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  finalizePdfWithFootersAndBottomQr(doc, company, getLastAutoTableFinalY(doc, tableStartY));
  doc.save('DomestiqHub_Laporan_Laba_Rugi.pdf');
}

export function exportMonthlyPerformancePdf(
  summary: MonthlyPerformanceSummary,
  company: CompanySettings
): void {
  exportTableToPdf({
    filename: 'DomestiqHub_Performa_Bulanan',
    title: 'Laporan Performa Keuangan & Operasional Bulanan',
    subtitle: `Dicetak pada ${new Date().toLocaleDateString('id-ID')}`,
    headers: [
      'Bulan',
      'Omzet (IDR)',
      'HPP (IDR)',
      'Laba Kotor',
      'Margin Kotor',
      'Beban OpEx',
      'Laba Bersih',
      'Nilai PO',
      'Nilai SO',
    ],
    rows: [
      ...summary.months.map((m) => [
        m.monthLabel,
        formatCurrency(m.revenueIdr),
        formatCurrency(m.cogsIdr),
        formatCurrency(m.grossProfitIdr),
        `${m.grossMarginPercent.toFixed(1)}%`,
        formatCurrency(m.operatingExpensesIdr),
        formatCurrency(m.netIncomeIdr),
        formatCurrency(m.poTotalIdr),
        formatCurrency(m.soTotalIdr),
      ]),
      [
        'TOTAL AKUMULASI',
        formatCurrency(summary.totalRevenueIdr),
        formatCurrency(summary.totalCogsIdr),
        formatCurrency(summary.totalGrossProfitIdr),
        summary.totalRevenueIdr > 0
          ? `${((summary.totalGrossProfitIdr / summary.totalRevenueIdr) * 100).toFixed(1)}%`
          : '0.0%',
        formatCurrency(summary.totalOperatingExpensesIdr),
        formatCurrency(summary.totalNetIncomeIdr),
        formatCurrency(summary.totalPoIdr),
        formatCurrency(summary.totalSoIdr),
      ],
    ],
    company,
    orientation: 'landscape',
  });
}

export async function exportPurchaseOrderPdf(
  po: PurchaseOrder,
  company: CompanySettings,
  supplier?: Supplier,
  warehouse?: Warehouse
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = 'PURCHASE ORDER (PO)';
  const metaStartY = drawCorporateBanner(doc, company, title, po.poNumber);

  const tableStartY = drawAlignedMetadataGrid(
    doc,
    metaStartY,
    [
      { label: 'Nomor PO', value: po.poNumber },
      {
        label: 'Status',
        value: `${po.status}${po.approvalTierRequired ? ` (${po.approvalTierRequired})` : ''}`,
      },
      { label: 'Supplier', value: supplier?.name || po.supplierName || po.supplierId },
      { label: 'Alamat Supplier', value: supplier?.address || '-' },
    ],
    [
      { label: 'Gudang Tujuan', value: warehouse?.name || po.warehouseName || po.warehouseId },
      { label: 'Tanggal PO', value: (po.createdAt || '').slice(0, 10) || '-' },
      { label: 'Target Kirim', value: po.expectedDate || '-' },
      { label: 'Mata Uang', value: po.currency },
    ]
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    head: [['No', 'SKU', 'Nama Barang', 'Satuan', 'Qty', 'Harga Satuan', 'Total']],
    body: po.items.map((item, idx) => [
      String(idx + 1),
      item.sku,
      item.productName,
      item.uomCode,
      String(item.qty),
      formatCurrency(item.unitPrice, po.currency),
      formatCurrency(item.lineTotal, po.currency),
    ]),
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 24 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 15, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
  });

  const blockStartY = getLastAutoTableFinalY(doc, tableStartY) + 5;
  const termsSummary = buildOrderTermsSummaryForPo(po, supplier, warehouse, company);
  const blockEndY = drawBottomTermsAndTotalsPdf(
    doc,
    blockStartY,
    termsSummary,
    [
      { label: 'Subtotal', value: formatCurrency(po.subtotal ?? po.totalAmount, po.currency) },
      { label: 'PPN', value: formatCurrency(po.taxAmount ?? 0, po.currency) },
      { label: 'Grand Total', value: formatCurrency(po.totalAmount, po.currency), isGrandTotal: true },
    ],
    company,
    title,
    po.poNumber
  );

  // Signatures
  const sigY = ensureSpaceForBlock(doc, blockEndY + 7, 28, company, title, po.poNumber);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('Dibuat Oleh,', 16, sigY);
  doc.text(po.approvalTierRequired === 'Direktur' ? 'Disetujui Direktur,' : 'Disetujui Manager,', 82, sigY);
  doc.text('Konfirmasi Supplier,', 148, sigY);

  doc.setDrawColor(148, 163, 184);
  doc.line(16, sigY + 16, 62, sigY + 16);
  doc.line(82, sigY + 16, 128, sigY + 16);
  doc.line(148, sigY + 16, 194, sigY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(po.createdByName || 'Purchasing', 16, sigY + 20.5);
  doc.text(po.directorApprovedBy ? 'Direktur Utama' : 'Operasional / Manager', 82, sigY + 20.5);
  doc.text(supplier?.contactPerson || 'PIC Supplier', 148, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-PO|${po.poNumber}|${po.supplierName || po.supplierId}|${po.totalAmount}|${po.status}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: po.poNumber,
      title: 'VERIFIKASI DIGITAL PURCHASE ORDER',
      detailLine: `Supplier: ${supplier?.name || po.supplierName || '-'} | Status: ${po.status} | Total: ${formatCurrency(po.totalAmount, po.currency)}`,
    },
    title,
    po.poNumber
  );

  doc.save(`${po.poNumber}.pdf`);
}

export function exportPurchaseOrderCsv(po: PurchaseOrder): void {
  exportTableToCsv(
    po.poNumber,
    [
      'No PO',
      'Tanggal',
      'Supplier',
      'Gudang',
      'Status',
      'Mata Uang',
      'SKU',
      'Nama Barang',
      'Satuan',
      'Qty Order',
      'Qty Diterima',
      'Harga Satuan',
      'Total Baris',
    ],
    po.items.map((item) => [
      po.poNumber,
      (po.createdAt || '').slice(0, 10),
      po.supplierName || po.supplierId,
      po.warehouseName || po.warehouseId,
      po.status,
      po.currency,
      item.sku,
      item.productName,
      item.uomCode,
      item.qty,
      item.fulfilledQty,
      item.unitPrice,
      item.lineTotal,
    ])
  );
}

export async function exportSalesOrderPdf(
  so: SalesOrder,
  company: CompanySettings,
  customer?: Customer,
  warehouse?: Warehouse
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = 'SALES ORDER (SO)';
  const metaStartY = drawCorporateBanner(doc, company, title, so.soNumber);

  const tableStartY = drawAlignedMetadataGrid(
    doc,
    metaStartY,
    [
      { label: 'Nomor SO', value: so.soNumber },
      { label: 'Status', value: so.status },
      { label: 'Customer', value: customer?.name || so.customerName || so.customerId },
      { label: 'Alamat Kirim', value: customer?.shippingAddress || customer?.address || '-' },
    ],
    [
      { label: 'Gudang Asal', value: warehouse?.name || so.warehouseName || so.warehouseId },
      { label: 'Tanggal SO', value: (so.createdAt || '').slice(0, 10) || '-' },
      { label: 'Jatuh Tempo', value: so.dueDate || '-' },
      { label: 'Ref. Invoice', value: so.invoiceNumber || '-' },
    ]
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    head: [['No', 'SKU', 'Nama Barang', 'Satuan', 'Order', 'Terkirim', 'Harga Satuan', 'Total']],
    body: so.items.map((item, idx) => [
      String(idx + 1),
      item.sku,
      item.productName,
      item.uomCode,
      String(item.qty),
      String(item.fulfilledQty),
      formatCurrency(item.unitPrice, so.currency),
      formatCurrency(item.lineTotal, so.currency),
    ]),
    styles: { fontSize: 7.8, cellPadding: 2.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 7.8 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      1: { cellWidth: 22 },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 15, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
      7: { cellWidth: 31, halign: 'right', fontStyle: 'bold' },
    },
  });

  const blockStartY = getLastAutoTableFinalY(doc, tableStartY) + 5;
  const termsSummary = buildOrderTermsSummaryForSo(so, customer, warehouse);
  const blockEndY = drawBottomTermsAndTotalsPdf(
    doc,
    blockStartY,
    termsSummary,
    [
      { label: 'Subtotal', value: formatCurrency(so.subtotal ?? so.totalAmount, so.currency) },
      { label: 'PPN', value: formatCurrency(so.taxAmount ?? 0, so.currency) },
      { label: 'Grand Total', value: formatCurrency(so.totalAmount, so.currency), isGrandTotal: true },
    ],
    company,
    title,
    so.soNumber
  );

  const sigY = ensureSpaceForBlock(doc, blockEndY + 7, 28, company, title, so.soNumber);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('Sales Representative,', 16, sigY);
  doc.text('Disetujui Manager,', 82, sigY);
  doc.text('Konfirmasi Customer,', 148, sigY);

  doc.setDrawColor(148, 163, 184);
  doc.line(16, sigY + 16, 62, sigY + 16);
  doc.line(82, sigY + 16, 128, sigY + 16);
  doc.line(148, sigY + 16, 194, sigY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(so.createdByName || 'Sales Team', 16, sigY + 20.5);
  doc.text('Operasional / Gudang', 82, sigY + 20.5);
  doc.text(customer?.contactPerson || 'PIC Customer', 148, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-SO|${so.soNumber}|${so.customerName || so.customerId}|${so.totalAmount}|${so.status}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: so.soNumber,
      title: 'VERIFIKASI DIGITAL SALES ORDER',
      detailLine: `Customer: ${customer?.name || so.customerName || '-'} | Status: ${so.status} | Total: ${formatCurrency(so.totalAmount, so.currency)}`,
    },
    title,
    so.soNumber
  );

  doc.save(`${so.soNumber}.pdf`);
}

export function exportSalesOrderCsv(so: SalesOrder): void {
  exportTableToCsv(
    so.soNumber,
    [
      'No SO',
      'Tanggal',
      'Customer',
      'Gudang',
      'Status',
      'Jatuh Tempo',
      'Invoice',
      'Mata Uang',
      'SKU',
      'Nama Barang',
      'Satuan',
      'Qty Order',
      'Terkirim',
      'Harga Satuan',
      'Total Baris',
    ],
    so.items.map((item) => [
      so.soNumber,
      (so.createdAt || '').slice(0, 10),
      so.customerName || so.customerId,
      so.warehouseName || so.warehouseId,
      so.status,
      so.dueDate || '-',
      so.invoiceNumber || '-',
      so.currency,
      item.sku,
      item.productName,
      item.uomCode,
      item.qty,
      item.fulfilledQty,
      item.unitPrice,
      item.lineTotal,
    ])
  );
}

export async function exportSuratJalanPdf(
  so: SalesOrder,
  company: CompanySettings,
  customer?: Customer,
  warehouse?: Warehouse,
  movement?: StockMovement
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const sjNumber = movement
    ? `SJ-${movement.movementNumber}`
    : `SJ-${so.soNumber.replace(/^SO-/, '')}`;
  const title = 'SURAT JALAN / DELIVERY ORDER';
  const metaStartY = drawCorporateBanner(doc, company, title, sjNumber);

  const fieldPicName = customer?.picWarehouseName || customer?.contactPerson || '-';
  const fieldPicPhone = customer?.picWarehousePhone || customer?.phone || '-';

  const tableStartY = drawAlignedMetadataGrid(
    doc,
    metaStartY,
    [
      { label: 'No. Surat Jalan', value: sjNumber },
      { label: 'Referensi SO', value: so.soNumber },
      {
        label: 'Tanggal Kirim',
        value: (movement?.createdAt || so.updatedAt || so.createdAt || '').slice(0, 10) || '-',
      },
      { label: 'Gudang Asal', value: warehouse?.name || so.warehouseName || so.warehouseId },
      { label: 'Alamat Gudang', value: warehouse?.address || '-' },
    ],
    [
      { label: 'Kepada Yth', value: customer?.name || so.customerName || so.customerId },
      {
        label: 'Alamat Kirim',
        value: customer?.shippingAddress || customer?.address || 'Alamat Kirim Customer B2B',
      },
      { label: 'PIC Penerima', value: `${fieldPicName} (${fieldPicPhone})` },
      { label: 'Ref. Invoice', value: so.invoiceNumber || '-' },
    ]
  );

  const lineItems = movement
    ? [
        {
          sku: movement.productSku || '-',
          name: movement.productName || '-',
          uom: so.items.find((i) => i.productId === movement.productId)?.uomCode || 'Unit',
          orderQty:
            so.items.find((i) => i.productId === movement.productId)?.qty ??
            Math.abs(movement.quantityDelta),
          shippedQty: Math.abs(movement.quantityDelta),
          note: movement.notes || 'Sesuai dokumen pengiriman',
        },
      ]
    : so.items.map((it) => ({
        sku: it.sku,
        name: it.productName,
        uom: it.uomCode,
        orderQty: it.qty,
        shippedQty: it.fulfilledQty > 0 ? it.fulfilledQty : it.qty,
        note:
          it.fulfilledQty > 0
            ? it.fulfilledQty >= it.qty
              ? 'Lengkap / Baik'
              : `Parsial (Sisa ${it.qty - it.fulfilledQty})`
            : 'Rencana Kirim (Draft)',
      }));

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    head: [['No', 'SKU', 'Nama Barang', 'Satuan', 'Qty Order', 'Qty Dikirim', 'Keterangan']],
    body: lineItems.map((row, idx) => [
      String(idx + 1),
      row.sku,
      row.name,
      row.uom,
      String(row.orderQty),
      String(row.shippedQty),
      row.note,
    ]),
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      1: { cellWidth: 23 },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
    },
  });

  let y = getLastAutoTableFinalY(doc, tableStartY) + 6;
  y = ensureSpaceForBlock(doc, y, 42, company, title, sjNumber);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const noteText = `Catatan Pengiriman: ${movement?.notes || so.notes || 'Harap periksa kondisi & jumlah barang saat diterima.'}`;
  const noteLines = doc.splitTextToSize(noteText, 180);
  doc.text(noteLines.slice(0, 2), 14, y);
  y += Math.max(1, noteLines.slice(0, 2).length) * 4.2 + 2;

  if (so.podReceiverName) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(21, 128, 61);
    doc.text(
      `e-POD Terverifikasi — Penerima: ${so.podReceiverName} (${(so.podTimestamp || '').slice(0, 16).replace('T', ' ')})`,
      14,
      y
    );
    y += 6;
  }

  const sigY = ensureSpaceForBlock(doc, y + 4, 28, company, title, sjNumber);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('Disiapkan Oleh (Gudang),', 16, sigY);
  doc.text('Pengemudi / Ekspedisi,', 82, sigY);
  doc.text('Diterima Baik Oleh,', 148, sigY);

  doc.setDrawColor(148, 163, 184);
  doc.line(16, sigY + 16, 62, sigY + 16);
  doc.line(82, sigY + 16, 128, sigY + 16);
  doc.line(148, sigY + 16, 194, sigY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(warehouse?.picName || 'Kepala Gudang', 16, sigY + 20.5);
  doc.text('Nama & No. Polisi', 82, sigY + 20.5);
  doc.text(so.podReceiverName || 'Nama Terang & Stempel', 148, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-SJ|${sjNumber}|${so.soNumber}|${customer?.name || so.customerId}|POD:${so.podReceiverName || 'PENDING'}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: sjNumber,
      title: 'VERIFIKASI DIGITAL SURAT JALAN (DO)',
      detailLine: `Ref. SO: ${so.soNumber} | Penerima: ${customer?.name || so.customerName || '-'} | e-POD: ${so.podReceiverName || 'Menunggu Serah Terima'}`,
    },
    title,
    sjNumber
  );

  doc.save(`${sjNumber}.pdf`);
}

export function exportSuratJalanCsv(so: SalesOrder, movement?: StockMovement): void {
  const sjNumber = movement
    ? `SJ-${movement.movementNumber}`
    : `SJ-${so.soNumber.replace(/^SO-/, '')}`;

  const rows = movement
    ? [
        [
          sjNumber,
          so.soNumber,
          (movement.createdAt || '').slice(0, 10),
          so.customerName || so.customerId,
          movement.warehouseName || so.warehouseName || so.warehouseId,
          movement.productSku || '-',
          movement.productName || '-',
          so.items.find((i) => i.productId === movement.productId)?.uomCode || 'Unit',
          Math.abs(movement.quantityDelta),
          movement.notes || '-',
        ],
      ]
    : so.items.map((it) => [
        sjNumber,
        so.soNumber,
        (so.updatedAt || so.createdAt || '').slice(0, 10),
        so.customerName || so.customerId,
        so.warehouseName || so.warehouseId,
        it.sku,
        it.productName,
        it.uomCode,
        it.fulfilledQty > 0 ? it.fulfilledQty : it.qty,
        so.notes || '-',
      ]);

  exportTableToCsv(
    sjNumber,
    [
      'No Surat Jalan',
      'Referensi SO',
      'Tanggal Kirim',
      'Customer',
      'Gudang Asal',
      'SKU',
      'Nama Barang',
      'Satuan',
      'Qty Dikirim',
      'Catatan',
    ],
    rows
  );
}

export function exportExecutiveBoardPdf(params: {
  lang: 'id' | 'en';
  company: CompanySettings;
  periodLabel: string;
  revenueIdr: number;
  grossProfitIdr: number;
  grossMarginPct: number;
  netIncomeIdr: number;
  netMarginPct: number;
  totalAssetsIdr: number;
  totalLiabilitiesIdr: number;
  totalEquityIdr: number;
  cashAndBankIdr: number;
  stockValueIdr: number;
  totalArIdr: number;
  totalApIdr: number;
  netWorkingCapitalIdr: number;
  monthlyRows: MonthlyPerformanceSummary['months'];
  topCustomers: ExecutiveRankItem[];
}): void {
  const isEn = params.lang === 'en';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startMetaY = drawCorporateBanner(
    doc,
    params.company,
    isEn
      ? 'EXECUTIVE & SHAREHOLDER BRIEFING REPORT'
      : 'LAPORAN RINGKASAN EKSEKUTIF & PEMEGANG SAHAM',
    params.periodLabel
  );

  const tableStartY = drawAlignedMetadataGrid(
    doc,
    startMetaY,
    [{ label: isEn ? 'Reporting Period' : 'Periode Laporan', value: params.periodLabel }],
    [{ label: isEn ? 'Reporting Standard' : 'Dasar Laporan', value: 'Posted General Ledger (IDR)' }]
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 18 },
    head: [
      [
        isEn ? 'Executive Metric' : 'Indikator Eksekutif',
        isEn ? 'Value (IDR)' : 'Nilai (IDR)',
        isEn ? 'Notes' : 'Keterangan',
      ],
    ],
    body: [
      [
        isEn ? 'Operating Revenue' : 'Pendapatan Usaha',
        formatCurrency(params.revenueIdr),
        isEn ? 'Posted General Ledger' : 'Buku Besar Terposting',
      ],
      [
        isEn ? 'Gross Profit' : 'Laba Kotor',
        formatCurrency(params.grossProfitIdr),
        `${isEn ? 'Gross Margin' : 'Margin Kotor'}: ${params.grossMarginPct.toFixed(1)}%`,
      ],
      [
        isEn ? 'Net Income' : 'Laba Bersih',
        formatCurrency(params.netIncomeIdr),
        `${isEn ? 'Net Margin' : 'Margin Bersih'}: ${params.netMarginPct.toFixed(1)}%`,
      ],
      [
        isEn ? 'Cash & Bank Position' : 'Posisi Kas & Bank',
        formatCurrency(params.cashAndBankIdr),
        isEn ? 'Liquid treasury balance' : 'Saldo kas & giro bank',
      ],
      [
        isEn ? 'Inventory Valuation' : 'Nilai Persediaan Gudang',
        formatCurrency(params.stockValueIdr),
        isEn ? 'All warehouses' : 'Seluruh gudang',
      ],
      [
        isEn ? 'Accounts Receivable (AR)' : 'Piutang Usaha (AR)',
        formatCurrency(params.totalArIdr),
        isEn ? 'Open customer receivables' : 'Tagihan customer aktif',
      ],
      [
        isEn ? 'Accounts Payable (AP)' : 'Hutang Usaha (AP)',
        formatCurrency(params.totalApIdr),
        isEn ? 'Open supplier payables' : 'Kewajiban supplier aktif',
      ],
      [
        isEn ? 'Net Working Capital' : 'Modal Kerja Bersih',
        formatCurrency(params.netWorkingCapitalIdr),
        isEn ? 'Cash + AR + Inventory - AP' : 'Kas + Piutang + Stok - Hutang',
      ],
      [
        isEn ? 'Total Assets / Equity' : 'Total Aset / Ekuitas',
        formatCurrency(params.totalAssetsIdr),
        `${isEn ? 'Liabilities' : 'Kewajiban'}: ${formatCurrency(params.totalLiabilitiesIdr)} | ${isEn ? 'Equity' : 'Ekuitas'}: ${formatCurrency(params.totalEquityIdr)}`,
      ],
    ],
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    alternateRowStyles: { fillColor: [244, 247, 251] },
  });

  let curY = getLastAutoTableFinalY(doc, tableStartY) + 6;

  if (params.monthlyRows.length > 0) {
    autoTable(doc, {
      startY: curY,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [
        [
          isEn ? 'Month' : 'Bulan',
          isEn ? 'Revenue' : 'Pendapatan',
          isEn ? 'Gross Profit' : 'Laba Kotor',
          isEn ? 'Net Income' : 'Laba Bersih',
          isEn ? 'PO Value' : 'Nilai PO',
          isEn ? 'SO Value' : 'Nilai SO',
        ],
      ],
      body: params.monthlyRows.slice(-6).map((m) => [
        m.monthLabel,
        formatCurrency(m.revenueIdr),
        formatCurrency(m.grossProfitIdr),
        formatCurrency(m.netIncomeIdr),
        formatCurrency(m.poTotalIdr),
        formatCurrency(m.soTotalIdr),
      ]),
      styles: { fontSize: 7.8, cellPadding: 2.1, textColor: [15, 23, 42] },
      headStyles: { fillColor: [27, 94, 153], textColor: [255, 255, 255], fontSize: 7.8 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right', fontStyle: 'bold' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
    });
    curY = getLastAutoTableFinalY(doc, curY) + 6;
  }

  if (params.topCustomers.length > 0) {
    autoTable(doc, {
      startY: curY,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [
        [
          isEn ? 'Top B2B Customers' : 'Top Customer B2B',
          isEn ? 'Orders' : 'Order',
          isEn ? 'Sales Value (IDR)' : 'Nilai Penjualan (IDR)',
          isEn ? 'Share' : 'Porsi',
        ],
      ],
      body: params.topCustomers.map((c) => [
        c.name,
        String(c.count),
        formatCurrency(c.amountIdr),
        `${c.sharePercent.toFixed(1)}%`,
      ]),
      styles: { fontSize: 7.8, cellPadding: 2.1, textColor: [15, 23, 42] },
      headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 7.8 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
    });
    curY = getLastAutoTableFinalY(doc, curY);
  }

  finalizePdfWithFootersAndBottomQr(doc, params.company, curY);
  doc.save(isEn ? 'DomestiqHub_Executive_Briefing.pdf' : 'DomestiqHub_Ringkasan_Eksekutif.pdf');
}

export async function exportSalesQuotationPdf(
  qt: SalesQuotation,
  company: CompanySettings,
  customer?: Customer,
  warehouse?: Warehouse
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = 'PENAWARAN HARGA / SALES QUOTATION';
  const metaStartY = drawCorporateBanner(doc, company, title, qt.quotationNumber);

  const tableStartY = drawAlignedMetadataGrid(
    doc,
    metaStartY,
    [
      { label: 'No. Penawaran', value: qt.quotationNumber },
      { label: 'Status', value: qt.status },
      { label: 'Kepada Yth', value: customer?.name || qt.customerName || qt.customerId },
      { label: 'Alamat Customer', value: customer?.address || '-' },
    ],
    [
      { label: 'Gudang Asal', value: warehouse?.name || qt.warehouseName || qt.warehouseId },
      { label: 'Tanggal Terbit', value: (qt.createdAt || '').slice(0, 10) || '-' },
      { label: 'Berlaku Hingga', value: qt.validUntil },
      {
        label: 'Syarat Bayar',
        value: resolvePaymentTermDisplay(
          qt.paymentTerm,
          qt.paymentTermCustom,
          customer?.paymentScheme || 'CBD'
        ),
      },
    ]
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    head: [['No', 'SKU', 'Deskripsi Barang', 'Satuan', 'Qty', 'Harga Satuan', 'Total']],
    body: qt.items.map((item, idx) => [
      String(idx + 1),
      item.sku,
      item.productName,
      item.uomCode,
      String(item.qty),
      formatCurrency(item.unitPrice, qt.currency),
      formatCurrency(item.lineTotal, qt.currency),
    ]),
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 24 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 15, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
  });

  const blockStartY = getLastAutoTableFinalY(doc, tableStartY) + 5;
  const termsSummary = buildOrderTermsSummaryForQuotation(qt, customer, warehouse);
  const blockEndY = drawBottomTermsAndTotalsPdf(
    doc,
    blockStartY,
    termsSummary,
    [
      { label: 'Subtotal (DPP)', value: formatCurrency(qt.subtotal, qt.currency) },
      {
        label: isCompanyPkp(company) ? `PPN ${getEffectiveTaxRatePercent(company)}%` : 'PPN (Non-PKP 0%)',
        value: formatCurrency(qt.taxAmount, qt.currency),
      },
      { label: 'Total Penawaran', value: formatCurrency(qt.totalAmount, qt.currency), isGrandTotal: true },
    ],
    company,
    title,
    qt.quotationNumber
  );

  const sigY = ensureSpaceForBlock(doc, blockEndY + 7, 28, company, title, qt.quotationNumber);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('Hormat Kami,', 16, sigY);
  doc.text('Persetujuan Customer (PO / Stempel),', 132, sigY);

  doc.setDrawColor(148, 163, 184);
  doc.line(16, sigY + 16, 68, sigY + 16);
  doc.line(132, sigY + 16, 194, sigY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(qt.createdByName || 'Commercial B2B', 16, sigY + 20.5);
  doc.text(customer?.contactPerson || 'PIC Purchasing Customer', 132, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-QT|${qt.quotationNumber}|${qt.customerName || qt.customerId}|${qt.totalAmount}|VALID:${qt.validUntil}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: qt.quotationNumber,
      title: 'VERIFIKASI DIGITAL QUOTATION PENAWARAN',
      detailLine: `Customer: ${customer?.name || qt.customerName || '-'} | Berlaku s/d: ${qt.validUntil} | Total: ${formatCurrency(qt.totalAmount, qt.currency)}`,
    },
    title,
    qt.quotationNumber
  );

  doc.save(`${qt.quotationNumber}.pdf`);
}

export async function exportSalesInvoicePdf(
  invoice: AccountingInvoice,
  company: CompanySettings,
  customer?: Customer,
  relatedSo?: SalesOrder,
  supplier?: Supplier
): Promise<void> {
  const isAp = invoice.ledgerType === 'AP';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = isAp
    ? 'DOKUMEN TAGIHAN SUPPLIER (AP INVOICE)'
    : 'INVOICE / FAKTUR PENJUALAN RESMI';
  const metaStartY = drawCorporateBanner(doc, company, title, invoice.invoiceNumber);

  const fpNumber = invoice.taxInvoiceNumber || relatedSo?.taxInvoiceNumber || '-';
  const tableStartY = drawAlignedMetadataGrid(
    doc,
    metaStartY,
    isAp
      ? [
          { label: 'No. Invoice', value: invoice.invoiceNumber },
          { label: 'Jenis Ledger', value: 'Hutang Usaha (AP)' },
          {
            label: 'Supplier',
            value: supplier?.name || invoice.counterpartyName || invoice.counterpartyId,
          },
          {
            label: 'NPWP Supplier',
            value: `${supplier?.npwp || '-'} (${supplier?.taxStatus || 'PKP'})`,
          },
          { label: 'Alamat Supplier', value: supplier?.address || '-' },
        ]
      : [
          { label: 'No. Invoice', value: invoice.invoiceNumber },
          { label: 'No. Faktur Pajak', value: fpNumber },
          {
            label: 'Kepada Yth',
            value: customer?.name || invoice.counterpartyName || invoice.counterpartyId,
          },
          {
            label: 'NPWP Buyer',
            value: `${customer?.npwp || '-'} (${customer?.taxStatus || 'PKP'})`,
          },
          { label: 'Alamat Tagih', value: customer?.billingAddress || customer?.address || '-' },
        ],
    [
      { label: 'Ref. Order', value: invoice.referenceOrderNumber || '-' },
      {
        label: 'Tgl Terbit',
        value: invoice.issueDate || (invoice.createdAt || '').slice(0, 10) || '-',
      },
      { label: 'Jatuh Tempo', value: invoice.dueDate },
      { label: 'Status Tagihan', value: invoice.status },
      { label: 'Mata Uang', value: invoice.currency },
    ]
  );

  const items = relatedSo?.items || [];
  const companyIsPkp = isCompanyPkp(company);
  const ratePct = getEffectiveTaxRatePercent(company);
  const divisor = ratePct > 0 ? 1 + ratePct / 100 : 1;
  const dpp = relatedSo?.subtotal ?? Math.round(invoice.totalAmount / divisor);
  const ppn = relatedSo?.taxAmount ?? Math.round(invoice.totalAmount - dpp);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    head: [['No', 'SKU', 'Deskripsi Barang / Jasa', 'Satuan', 'Qty', 'Harga Satuan', 'Total']],
    body:
      items.length > 0
        ? items.map((it, idx) => [
            String(idx + 1),
            it.sku,
            it.productName,
            it.uomCode,
            String(it.qty),
            formatCurrency(it.unitPrice, invoice.currency),
            formatCurrency(it.lineTotal, invoice.currency),
          ])
        : [
            [
              '1',
              invoice.referenceOrderNumber || '-',
              isAp
                ? `Tagihan Pengadaan Supplier (${invoice.invoiceNumber})`
                : `Tagihan Penjualan Barang Dagang (${invoice.invoiceNumber})`,
              'LOT',
              '1',
              formatCurrency(dpp, invoice.currency),
              formatCurrency(dpp, invoice.currency),
            ],
          ],
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 24 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 15, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
  });

  let y = getLastAutoTableFinalY(doc, tableStartY) + 5;
  y = ensureSpaceForBlock(doc, y, 66, company, title, invoice.invoiceNumber);

  // Bank transfer instructions box (Left)
  doc.setFillColor(244, 247, 251);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, 98, 28, 1.2, 1.2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(11, 27, 58);
  doc.text(
    isAp ? 'REKENING TUJUAN PEMBAYARAN SUPPLIER:' : 'REKENING PEMBAYARAN RESMI:',
    18,
    y + 6
  );
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text(
    isAp
      ? supplier?.bankName || 'Sesuai Rekening Supplier Terdaftar'
      : company.bankName || 'Bank Mandiri Korporat',
    18,
    y + 12
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('No. Rek', 18, y + 17.5);
  doc.text(':', 33, y + 17.5);
  doc.text(
    isAp ? supplier?.bankAccount || '-' : company.bankAccountNumber || '-',
    35.5,
    y + 17.5
  );
  doc.text('a/n', 18, y + 23);
  doc.text(':', 33, y + 23);
  doc.text(
    isAp
      ? supplier?.name || invoice.counterpartyName || '-'
      : company.bankAccountHolder || company.companyName,
    35.5,
    y + 23
  );

  // Totals Summary Card (Right)
  doc.setFillColor(244, 247, 251);
  doc.setDrawColor(216, 226, 239);
  doc.roundedRect(116, y, 80, 31, 1.2, 1.2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('DPP', 120, y + 5.5);
  doc.text(':', 144, y + 5.5);
  doc.setTextColor(15, 23, 42);
  doc.text(formatCurrency(dpp, invoice.currency), 192, y + 5.5, { align: 'right' });

  doc.setTextColor(71, 85, 105);
  doc.text(companyIsPkp ? `PPN (${ratePct}%)` : 'PPN (Non-PKP 0%)', 120, y + 10.5);
  doc.text(':', 144, y + 10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(formatCurrency(ppn, invoice.currency), 192, y + 10.5, { align: 'right' });

  doc.setTextColor(71, 85, 105);
  doc.text('Total Tagihan', 120, y + 15.5);
  doc.text(':', 144, y + 15.5);
  doc.setTextColor(15, 23, 42);
  doc.text(formatCurrency(invoice.totalAmount, invoice.currency), 192, y + 15.5, { align: 'right' });

  doc.setTextColor(71, 85, 105);
  doc.text('Sudah Dibayar', 120, y + 20.5);
  doc.text(':', 144, y + 20.5);
  doc.setTextColor(21, 128, 61);
  doc.text(formatCurrency(invoice.paidAmount, invoice.currency), 192, y + 20.5, { align: 'right' });

  doc.setDrawColor(203, 213, 225);
  doc.line(120, y + 23, 192, y + 23);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.6);
  doc.setTextColor(27, 94, 153);
  doc.text('Sisa Tagihan', 120, y + 27.8);
  doc.text(':', 144, y + 27.8);
  doc.text(formatCurrency(invoice.balanceDue, invoice.currency), 192, y + 27.8, { align: 'right' });

  const sigY = ensureSpaceForBlock(doc, y + 37, 28, company, title, invoice.invoiceNumber);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text(isAp ? 'Bagian Keuangan / AP,' : 'Bagian Keuangan / AR,', 140, sigY);
  doc.setDrawColor(148, 163, 184);
  doc.line(140, sigY + 16, 194, sigY + 16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(company.companyName, 140, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-INV|${invoice.invoiceNumber}|FP:${fpNumber}|${invoice.totalAmount}|${invoice.status}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: invoice.invoiceNumber,
      title: isAp
        ? 'VERIFIKASI DIGITAL TAGIHAN SUPPLIER (AP)'
        : 'VERIFIKASI DIGITAL INVOICE / FAKTUR PENJUALAN',
      detailLine: `${isAp ? 'Ref PO' : 'No. Faktur Pajak'}: ${isAp ? invoice.referenceOrderNumber || '-' : fpNumber} | Partner: ${(isAp ? supplier?.name : customer?.name) || invoice.counterpartyName || '-'} | Sisa: ${formatCurrency(invoice.balanceDue, invoice.currency)}`,
    },
    title,
    invoice.invoiceNumber
  );

  doc.save(`${invoice.invoiceNumber}.pdf`);
}

export async function exportPaymentReceiptPdf(
  invoice: AccountingInvoice,
  payment: InvoicePayment,
  company: CompanySettings
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const kwNumber = `KWT-${payment.id.toUpperCase()}`;
  const title = 'KWITANSI PEMBAYARAN RESMI / OFFICIAL RECEIPT';
  const startMetaY = drawCorporateBanner(doc, company, title, kwNumber);

  const amountIdr =
    payment.currency === 'USD'
      ? Math.round(payment.amount * (payment.exchangeRate || invoice.exchangeRate || 16200))
      : Math.round(payment.amount);

  const tableStartY = drawAlignedMetadataGrid(
    doc,
    startMetaY,
    [
      { label: 'No. Kwitansi', value: kwNumber },
      { label: 'No. Invoice', value: `${invoice.invoiceNumber} (${invoice.ledgerType})` },
      { label: 'Order Referensi', value: invoice.referenceOrderNumber || '-' },
    ],
    [
      { label: 'Tanggal Bayar', value: (payment.paidAt || '').slice(0, 10) || '-' },
      { label: 'Metode Pembayaran', value: payment.paymentMethod },
      { label: 'Status Invoice', value: invoice.status },
    ]
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    theme: 'grid',
    head: [['Keterangan Dokumen', 'Detail Pembayaran']],
    body: [
      [
        invoice.ledgerType === 'AR' ? 'Sudah Terima Dari' : 'Dibayarkan Kepada',
        invoice.counterpartyName || invoice.counterpartyId,
      ],
      ['Nomor Referensi Transfer / Giro', payment.referenceNo || '-'],
      ['Nominal Pembayaran', formatCurrency(payment.amount, payment.currency)],
      ['Terbilang (IDR Ekuivalen)', terbilangId(amountIdr)],
      ['Catatan Transaksi', payment.notes || 'Pembayaran tercatat sah pada sistem akuntansi ERP.'],
    ],
    styles: { fontSize: 8.5, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold', fillColor: [244, 247, 251] },
    },
  });

  let y = getLastAutoTableFinalY(doc, tableStartY) + 8;
  y = ensureSpaceForBlock(doc, y, 36, company, title, kwNumber);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Sisa Saldo Invoice Setelah Transaksi Ini: ${formatCurrency(invoice.balanceDue, invoice.currency)} (${invoice.status})`,
    14,
    y
  );

  const sigY = ensureSpaceForBlock(doc, y + 10, 28, company, title, kwNumber);
  doc.setFontSize(7.8);
  doc.text('Dicatat Oleh (Finance),', 140, sigY);
  doc.setDrawColor(148, 163, 184);
  doc.line(140, sigY + 16, 194, sigY + 16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(payment.recordedByName || 'Finance Team', 140, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-KWT|${kwNumber}|${invoice.invoiceNumber}|${payment.amount}|${payment.referenceNo || '-'}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: kwNumber,
      title: 'VERIFIKASI DIGITAL KWITANSI PEMBAYARAN',
      detailLine: `Invoice: ${invoice.invoiceNumber} | Nominal: ${formatCurrency(payment.amount, payment.currency)} | Ref: ${payment.referenceNo || '-'}`,
    },
    title,
    kwNumber
  );

  doc.save(`${kwNumber}.pdf`);
}

export async function exportSupplierRegistrationPdf(
  supplier: Supplier,
  company: CompanySettings
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const regCode = formatPartnerRegistrationNumber(
    supplier.code,
    supplier.id,
    supplier.createdAt || supplier.verifiedAt || supplier.updatedAt
  );
  const title = 'BUKTI REGISTRASI VENDOR / SUPPLIER RESMI';
  const startMetaY = drawCorporateBanner(doc, company, title, regCode);

  const verifiedDate = (supplier.verifiedAt || supplier.updatedAt || supplier.createdAt || '').slice(0, 10) || '-';
  const tableStartY = drawAlignedMetadataGrid(
    doc,
    startMetaY,
    [
      { label: 'No. Registrasi', value: regCode },
      { label: 'Kode Supplier', value: supplier.code },
      { label: 'Status Registrasi', value: `${supplier.verificationStatus || 'Verified'} (Disetujui Direktur)` },
      { label: 'Tanggal Approve', value: verifiedDate },
    ],
    [
      { label: 'Kategori Vendor', value: supplier.vendorCategory || '-' },
      { label: 'Skema Pembayaran', value: `${supplier.paymentScheme || '-'} (${supplier.paymentTermDays} Hari)` },
      { label: 'Mata Uang Default', value: supplier.defaultCurrency },
      { label: 'Status Aktif', value: supplier.active ? 'Aktif Bekerjasama' : 'Non-Aktif' },
    ]
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    theme: 'grid',
    head: [['Atribut Data Partner', 'Informasi Terverifikasi Sistem ERP']],
    body: [
      ['Nama Perusahaan / Vendor', supplier.name],
      ['Nomor Induk Berusaha (NIB)', supplier.nib || '-'],
      ['NPWP & Status Pajak', `${supplier.npwp || '-'} (${supplier.taxStatus || 'PKP'})`],
      ['Alamat Operasional / Kantor', supplier.address || '-'],
      ['Kontak Person (PIC)', supplier.contactPerson || '-'],
      ['No. Telepon / WhatsApp', supplier.phone || '-'],
      ['Email Bisnis Resmi', supplier.email || '-'],
      ['Rekening Pembayaran Bank', `${supplier.bankName || '-'} — ${supplier.bankAccount || '-'}`],
    ],
    styles: { fontSize: 8.3, cellPadding: 2.8, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8.3 },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold', fillColor: [244, 247, 251] },
    },
  });

  let y = getLastAutoTableFinalY(doc, tableStartY) + 7;
  y = ensureSpaceForBlock(doc, y, 42, company, title, regCode);

  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(14, y, 182, 13, 1.2, 1.2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(6, 95, 70);
  doc.text('PERNYATAAN REGISTRASI SAH:', 18, y + 5.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.text(
    `Partner di atas telah resmi disetujui & terdaftar sebagai Vendor/Supplier aktif pada ${company.companyName || 'PT Domestiq Hub Indonesia'}.`,
    18,
    y + 10
  );

  const sigY = ensureSpaceForBlock(doc, y + 20, 28, company, title, regCode);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('Mengetahui (Vendor),', 16, sigY);
  doc.text('Disahkan Oleh (Direktur / Admin),', 134, sigY);

  doc.setDrawColor(148, 163, 184);
  doc.line(16, sigY + 16, 68, sigY + 16);
  doc.line(134, sigY + 16, 194, sigY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(supplier.contactPerson || supplier.name, 16, sigY + 20.5);
  doc.text(company.companyName || 'Direktur Utama', 134, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-REG-SUP|${regCode}|${supplier.name}|NIB:${supplier.nib || '-'}|NPWP:${supplier.npwp || '-'}|${verifiedDate}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: regCode,
      title: 'VERIFIKASI DIGITAL BUKTI REGISTRASI SUPPLIER',
      detailLine: `Vendor: ${supplier.name} (${supplier.code}) | NIB: ${supplier.nib || '-'} | Status: ${supplier.verificationStatus || 'Verified'}`,
    },
    title,
    regCode
  );

  doc.save(`Bukti_Registrasi_Supplier_${supplier.code || supplier.id}.pdf`);
}

export async function exportBuyerRegistrationPdf(
  customer: Customer,
  company: CompanySettings
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const regCode = formatPartnerRegistrationNumber(
    customer.code,
    customer.id,
    customer.createdAt || customer.verifiedAt || customer.updatedAt
  );
  const title = 'BUKTI REGISTRASI BUYER / CUSTOMER B2B RESMI';
  const startMetaY = drawCorporateBanner(doc, company, title, regCode);

  const verifiedDate = (customer.verifiedAt || customer.updatedAt || customer.createdAt || '').slice(0, 10) || '-';
  const tableStartY = drawAlignedMetadataGrid(
    doc,
    startMetaY,
    [
      { label: 'No. Registrasi', value: regCode },
      { label: 'Kode Buyer', value: customer.code },
      { label: 'Status Registrasi', value: `${customer.verificationStatus || 'Verified'} (Disetujui Direktur)` },
      { label: 'Tanggal Approve', value: verifiedDate },
    ],
    [
      { label: 'Skema Pembayaran', value: `${customer.paymentScheme || 'CBD'} (${customer.paymentTermDays || 0} Hari)` },
      { label: 'Limit Kredit Disetujui', value: formatCurrency(customer.creditLimit || 0, 'IDR') },
      { label: 'Status Pajak', value: customer.taxStatus || 'PKP' },
      { label: 'Status Aktif', value: customer.active ? 'Aktif Bertransaksi' : 'Non-Aktif' },
    ]
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14, bottom: 40 },
    theme: 'grid',
    head: [['Atribut Profil Buyer B2B', 'Informasi Terverifikasi Sistem ERP']],
    body: [
      ['Nama Perusahaan Buyer', customer.name],
      ['Nomor Induk Berusaha (NIB)', customer.nib || '-'],
      ['Nomor Pokok Wajib Pajak (NPWP)', customer.npwp || '-'],
      ['Alamat Penagihan (Billing)', customer.billingAddress || customer.address || '-'],
      ['Alamat Pengiriman (Shipping)', customer.shippingAddress || customer.address || '-'],
      [
        'PIC Purchasing',
        `${customer.picPurchasingName || customer.contactPerson || '-'} (${customer.picPurchasingPhone || customer.phone || '-'})`,
      ],
      [
        'PIC Gudang / Penerima',
        `${customer.picWarehouseName || '-'} (${customer.picWarehousePhone || '-'})`,
      ],
      [
        'PIC Finance / AP',
        `${customer.picFinanceName || '-'} (${customer.picFinancePhone || '-'})`,
      ],
      ['Email Korespondensi', customer.email || '-'],
    ],
    styles: { fontSize: 8.2, cellPadding: 2.6, textColor: [15, 23, 42] },
    headStyles: { fillColor: [11, 27, 58], textColor: [255, 255, 255], fontSize: 8.2 },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold', fillColor: [244, 247, 251] },
    },
  });

  let y = getLastAutoTableFinalY(doc, tableStartY) + 7;
  y = ensureSpaceForBlock(doc, y, 42, company, title, regCode);

  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(14, y, 182, 13, 1.2, 1.2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(6, 95, 70);
  doc.text('PERNYATAAN REGISTRASI SAH:', 18, y + 5.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.text(
    `Buyer di atas telah disetujui dan berhak melakukan transaksi B2B sesuai limit kredit pada ${company.companyName || 'PT Domestiq Hub Indonesia'}.`,
    18,
    y + 10
  );

  const sigY = ensureSpaceForBlock(doc, y + 20, 28, company, title, regCode);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('Perwakilan Buyer,', 16, sigY);
  doc.text('Disahkan Oleh (Direktur / Admin),', 134, sigY);

  doc.setDrawColor(148, 163, 184);
  doc.line(16, sigY + 16, 68, sigY + 16);
  doc.line(134, sigY + 16, 194, sigY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(customer.picPurchasingName || customer.contactPerson || customer.name, 16, sigY + 20.5);
  doc.text(company.companyName || 'Direktur Utama', 134, sigY + 20.5);

  const qrUrl = await generateQrDataUrl(
    `DHI-REG-BUY|${regCode}|${customer.name}|NIB:${customer.nib || '-'}|LIMIT:${customer.creditLimit || 0}|${verifiedDate}`
  );
  finalizePdfWithFootersAndBottomQr(
    doc,
    company,
    sigY + 24,
    {
      qrDataUrl: qrUrl,
      code: regCode,
      title: 'VERIFIKASI DIGITAL BUKTI REGISTRASI BUYER B2B',
      detailLine: `Buyer: ${customer.name} (${customer.code}) | Limit: ${formatCurrency(customer.creditLimit || 0, 'IDR')} | Skema: ${customer.paymentScheme || 'CBD'}`,
    },
    title,
    regCode
  );

  doc.save(`Bukti_Registrasi_Buyer_${customer.code || customer.id}.pdf`);
}

export function exportVatReconciliationPdf(
  summary: VatReconciliationSummary,
  company: CompanySettings
): void {
  const companyIsPkp = isCompanyPkp(company);
  const ratePct = getEffectiveTaxRatePercent(company);
  exportTableToPdf({
    filename: `DomestiqHub_Rekap_PPN_${summary.periodMonthKey || 'ALL'}`,
    title: `Laporan Rekonsiliasi PPN Masukan vs Keluaran (${companyIsPkp ? `PKP ${ratePct}%` : 'Non-PKP 0%'}) — Periode ${summary.periodMonthKey}`,
    subtitle: `Net PPN (${summary.statusLabel}): ${formatCurrency(Math.abs(summary.netVatPayableIdr), 'IDR')} | NPWP: ${company.npwp || '-'}`,
    headers: ['Tanggal', 'No. Dokumen', 'Faktur Pajak', 'Jenis', 'Partner', 'DPP (IDR)', 'PPN (IDR)'],
    rows: [
      ...summary.details.map((d) => [
        d.date,
        d.docNumber,
        d.taxInvoiceNumber || '-',
        d.type,
        d.counterpartyName,
        formatCurrency(d.dppIdr),
        formatCurrency(d.vatIdr),
      ]),
      [
        '-',
        'RINGKASAN',
        '-',
        summary.statusLabel,
        'PPN Keluaran Netto - PPN Masukan Netto',
        '-',
        formatCurrency(summary.netVatPayableIdr),
      ],
    ],
    company,
    orientation: 'landscape',
  });
}
