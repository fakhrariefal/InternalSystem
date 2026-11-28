import { FileDown, Printer, X } from 'lucide-react';
import QRCode from 'qrcode';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { PrintableDocumentData } from '../models/printDocumentModel';
import { Button } from './ui/primitives';

interface PrintPreviewRequest {
  data: PrintableDocumentData;
  onDownloadPdf?: () => Promise<void> | void;
}

interface PrintDocumentContextValue {
  openPrintPreview: (
    data: PrintableDocumentData,
    onDownloadPdf?: () => Promise<void> | void
  ) => void;
  closePrintPreview: () => void;
}

const PrintDocumentContext = createContext<PrintDocumentContextValue>({
  openPrintPreview: () => {},
  closePrintPreview: () => {},
});

export function usePrintDocument(): PrintDocumentContextValue {
  return useContext(PrintDocumentContext);
}

export function PrintableDocumentSheet({ data }: { data: PrintableDocumentData }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(data.qrVerification.payload, {
      margin: 1,
      width: 160,
      color: { dark: '#0B1B3A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch(() => {
        if (active) setQrUrl(null);
      });
    return () => {
      active = false;
    };
  }, [data.qrVerification.payload]);

  const printedDateShort = new Date().toLocaleDateString('id-ID');
  const printedTimestamp = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const sigCols = Math.max(1, Math.min(3, data.signatures.length || 1));

  return (
    <article
      className={`print-doc-sheet ${data.orientation === 'landscape' ? 'print-doc-sheet--landscape' : ''}`}
      data-doc-type={data.docType}
      data-doc-number={data.documentNumber}
      aria-label={`Dokumen cetak ${data.documentNumber}`}
    >
      {/* Unified Corporate Banner */}
      <header className="print-doc-banner">
        <div>
          <div className="print-doc-brand-name">
            {data.company.companyName || 'PT Domestiq Hub Indonesia'}
          </div>
          <div className="print-doc-brand-meta">
            <div>{data.company.address || 'Jakarta, Indonesia'}</div>
            <div>
              NPWP: {data.company.npwp || '-'} &nbsp;|&nbsp; Telp: {data.company.phone || '-'} &nbsp;|&nbsp; Email:{' '}
              {data.company.email || '-'}
            </div>
          </div>
        </div>
        <div className="print-doc-banner-badge">
          <div className="print-doc-banner-date">Dicetak: {printedDateShort}</div>
        </div>
      </header>

      {/* Document Title Strip */}
      <div className="print-doc-title-strip">
        <div className="print-doc-title-text">{data.documentTitle}</div>
        <div className="print-doc-number-badge">{data.documentNumber}</div>
      </div>

      {/* Aligned Two-Column Key : Value Metadata Grid */}
      <section className="print-doc-meta-grid" aria-label="Informasi metadata dokumen">
        <div className="print-doc-meta-col">
          {data.leftMeta.map((row, idx) => (
            <div key={`lm_${idx}_${row.label}`} className="print-doc-meta-row">
              <span className="print-doc-meta-label">{row.label}</span>
              <span className="print-doc-colon" aria-hidden="true">:</span>
              <span className="print-doc-meta-value">{row.value || '-'}</span>
            </div>
          ))}
        </div>
        <div className="print-doc-meta-col">
          {data.rightMeta.map((row, idx) => (
            <div key={`rm_${idx}_${row.label}`} className="print-doc-meta-row">
              <span className="print-doc-meta-label">{row.label}</span>
              <span className="print-doc-colon" aria-hidden="true">:</span>
              <span className="print-doc-meta-value">{row.value || '-'}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Main Line Items / Attributes Table */}
      <section className="print-doc-table-wrap">
        <table className={`print-doc-table ${data.columns.length <= 2 ? 'print-doc-table--compact' : ''}`}>
          <thead>
            <tr>
              {data.columns.map((col, idx) => (
                <th
                  key={`th_${idx}`}
                  className={col.widthClass}
                  style={{ textAlign: col.align || 'left' }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rIdx) => (
              <tr key={`tr_${rIdx}`}>
                {row.map((cell, cIdx) => {
                  const col = data.columns[cIdx];
                  return (
                    <td
                      key={`td_${rIdx}_${cIdx}`}
                      style={{
                        textAlign: col?.align || 'left',
                        fontWeight: col?.bold ? 700 : 400,
                        fontFamily: col?.mono ? 'var(--font-mono)' : undefined,
                        fontVariantNumeric: col?.mono ? 'tabular-nums' : undefined,
                        whiteSpace: col?.mono ? 'nowrap' : undefined,
                      }}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Summary / Terms & Conditions / Bank Transfer / Notes Section */}
      {(data.termsSection || data.bankInfo || data.notesText || (data.totals && data.totals.length > 0)) && (
        <section className="print-doc-summary-grid">
          <div className="space-y-3">
            {data.termsSection && (
              <div className="print-doc-terms-box" data-testid="print-terms-section">
                <div className="print-doc-notes-title">{data.termsSection.heading}</div>
                <div className="print-doc-terms-meta">
                  {data.termsSection.metaRows.map((mRow, idx) => (
                    <div key={`tm_${idx}_${mRow.label}`} className="print-doc-terms-kv">
                      <span className="print-doc-meta-label">{mRow.label}</span>
                      <span className="print-doc-colon" aria-hidden="true">:</span>
                      <span className="print-doc-meta-value">{mRow.value || '-'}</span>
                    </div>
                  ))}
                </div>
                {data.termsSection.mandatoryNotice && (
                  <div className="print-doc-po-notice">
                    <strong>Catatan Wajib:</strong> {data.termsSection.mandatoryNotice}
                  </div>
                )}
                <div className="print-doc-notes-text print-doc-terms-body">
                  {data.termsSection.termsText}
                </div>
                {data.termsSection.additionalNotes && (
                  <div className="print-doc-terms-extra">
                    <span className="font-semibold text-[#475569]">Catatan Tambahan: </span>
                    <span className="whitespace-pre-wrap">{data.termsSection.additionalNotes}</span>
                  </div>
                )}
              </div>
            )}
            {data.bankInfo && (
              <div className="print-doc-bank-box">
                <div className="print-doc-notes-title">{data.bankInfo.heading}</div>
                <div className="font-bold text-[#0B1B3A] mb-1">{data.bankInfo.bankName}</div>
                {data.bankInfo.rows.map((bRow, idx) => (
                  <div key={`bk_${idx}`} className="print-doc-kv-row">
                    <span className="print-doc-meta-label">{bRow.label}</span>
                    <span className="print-doc-colon" aria-hidden="true">:</span>
                    <span className="print-doc-meta-value">{bRow.value || '-'}</span>
                  </div>
                ))}
              </div>
            )}
            {data.notesText && (
              <div className="print-doc-notes-box">
                {data.notesTitle && (
                  <div className="print-doc-notes-title">{data.notesTitle}:</div>
                )}
                <div className="print-doc-notes-text">{data.notesText}</div>
              </div>
            )}
          </div>

          {data.totals && data.totals.length > 0 && (
            <div className="print-doc-totals-box">
              {data.totals.map((tRow, idx) => (
                <div
                  key={`tot_${idx}`}
                  className={`print-doc-total-row ${tRow.isGrandTotal ? 'print-doc-total-row--grand' : ''}`}
                >
                  <span
                    className={
                      tRow.isGrandTotal ? 'font-bold text-[#0B1B3A]' : 'print-doc-meta-label'
                    }
                  >
                    {tRow.label}
                  </span>
                  <span className="print-doc-colon" aria-hidden="true">:</span>
                  <span
                    className="print-doc-total-val"
                    style={{
                      color:
                        tRow.tone === 'success'
                          ? '#15803D'
                          : tRow.tone === 'accent'
                          ? '#1B5E99'
                          : '#0B1B3A',
                    }}
                  >
                    {tRow.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Optional Verified Status Banner */}
      {data.statusBanner && (
        <section
          className={`print-doc-status-banner ${
            data.statusBanner.tone === 'success'
              ? 'print-doc-status-banner--success'
              : 'print-doc-status-banner--info'
          }`}
        >
          {data.statusBanner.title && (
            <div className="font-bold mb-0.5">{data.statusBanner.title}</div>
          )}
          <div>{data.statusBanner.text}</div>
        </section>
      )}

      {/* Signature Block */}
      {data.signatures.length > 0 && (
        <section
          className={`print-doc-signatures ${
            data.signatures.length === 1 ? 'print-doc-signatures--single' : ''
          }`}
          style={{ gridTemplateColumns: `repeat(${sigCols}, minmax(0, 1fr))` }}
        >
          {data.signatures.map((sig, idx) => (
            <div key={`sig_${idx}`} className="print-doc-sig-slot">
              <div>{sig.roleLabel}</div>
              <div className="print-doc-sig-line">{sig.signerName}</div>
            </div>
          ))}
        </section>
      )}

      {/* Bottom-Anchored Barcode & Page Footer */}
      <footer className="print-doc-bottom-dock">
        <div className="print-doc-qr-box" data-testid="print-bottom-barcode">
          {qrUrl && (
            <img
              src={qrUrl}
              alt={`Barcode Verifikasi ${data.qrVerification.code}`}
              className="print-doc-qr-img"
            />
          )}
          <div className="print-doc-qr-meta">
            <div className="print-doc-qr-title">{data.qrVerification.title}</div>
            <div className="print-doc-qr-code-row">
              <span>Kode Validasi</span>
              <span className="print-doc-colon" aria-hidden="true">:</span>
              <span>{data.qrVerification.code}</span>
            </div>
            <div className="print-doc-qr-detail">{data.qrVerification.detailLine}</div>
          </div>
        </div>
        <div className="print-doc-footer">
          <span>
            {data.company.companyName || 'PT Domestiq Hub Indonesia'} &nbsp;|&nbsp; NPWP:{' '}
            {data.company.npwp || '-'}
          </span>
          <span>Dicetak: {printedTimestamp}</span>
        </div>
      </footer>
    </article>
  );
}

export function PrintDocumentProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PrintPreviewRequest | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const openPrintPreview = useCallback(
    (data: PrintableDocumentData, onDownloadPdf?: () => Promise<void> | void) => {
      setRequest({ data, onDownloadPdf });
    },
    []
  );

  const closePrintPreview = useCallback(() => {
    setRequest(null);
  }, []);

  useEffect(() => {
    if (!request) {
      document.body.classList.remove('printing-document-modal');
      return;
    }
    document.body.classList.add('printing-document-modal');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePrintPreview();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.classList.remove('printing-document-modal');
    };
  }, [closePrintPreview, request]);

  return (
    <PrintDocumentContext.Provider value={{ openPrintPreview, closePrintPreview }}>
      {children}
      {request &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="print-doc-portal"
            role="dialog"
            aria-modal="true"
            aria-label={`Pratinjau Cetak ${request.data.documentNumber}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              className={`print-doc-toolbar no-print ${
                request.data.orientation === 'landscape' ? 'print-doc-toolbar--landscape' : ''
              }`}
            >
              <div>
                <div className="text-sm font-semibold text-white">
                  Pratinjau Cetak Dokumen — {request.data.documentNumber}
                </div>
                <div className="text-[11px] text-slate-300">
                  Tata letak A4 {request.data.orientation === 'landscape' ? 'Landscape' : 'Portrait'} · Periksa isi dokumen sebelum cetak atau unduh PDF
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="gold"
                  size="sm"
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Cetak / Print A4
                </Button>
                {request.onDownloadPdf && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={downloadingPdf}
                    onClick={async () => {
                      if (!request.onDownloadPdf) return;
                      setDownloadingPdf(true);
                      try {
                        await request.onDownloadPdf();
                      } finally {
                        setDownloadingPdf(false);
                      }
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                    {downloadingPdf ? 'Mengunduh...' : 'Unduh PDF'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closePrintPreview}
                  className="text-white hover:bg-white/15 hover:text-white"
                >
                  <X className="h-4 w-4" />
                  Tutup
                </Button>
              </div>
            </div>

            <PrintableDocumentSheet data={request.data} />
          </div>,
          document.body
        )}
    </PrintDocumentContext.Provider>
  );
}
