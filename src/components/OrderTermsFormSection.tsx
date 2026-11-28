import type { ReactNode } from 'react';
import { FileCheck2, RotateCcw } from 'lucide-react';
import { formatCurrency } from '../models/erpLogic';
import {
  INCOTERM_OPTIONS,
  MANDATORY_PO_ATTACHMENT_NOTE,
  PAYMENT_TERM_OPTIONS,
} from '../models/orderTerms';
import type { CurrencyCode, PaymentTermOption } from '../models/types';
import { Button, Input, Label, NativeSelect, Textarea } from './ui/primitives';

export type OrderTermsDocType = 'QUOTATION' | 'SALES_ORDER' | 'PURCHASE_ORDER';

export interface OrderTermsFormSectionProps {
  idPrefix: string;
  docType: OrderTermsDocType;
  paymentTerm: PaymentTermOption;
  onPaymentTermChange: (term: PaymentTermOption) => void;
  paymentTermCustom: string;
  onPaymentTermCustomChange: (val: string) => void;
  incoterm: string;
  onIncotermChange: (val: string) => void;
  deliveryLocation: string;
  onDeliveryLocationChange: (val: string) => void;
  termsAndConditions: string;
  onTermsAndConditionsChange: (val: string) => void;
  validityPeriod?: string;
  onValidityPeriodChange?: (val: string) => void;
  leadTime?: string;
  onLeadTimeChange?: (val: string) => void;
  sourceBadge?: string;
  onResetDefaultTerms?: () => void;
  currency: CurrencyCode;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  companyIsPkp: boolean;
  effectiveTaxRate: number;
  extraTotalsNode?: ReactNode;
}

export function OrderTermsFormSection({
  idPrefix,
  docType,
  paymentTerm,
  onPaymentTermChange,
  paymentTermCustom,
  onPaymentTermCustomChange,
  incoterm,
  onIncotermChange,
  deliveryLocation,
  onDeliveryLocationChange,
  termsAndConditions,
  onTermsAndConditionsChange,
  validityPeriod = '',
  onValidityPeriodChange,
  leadTime = '',
  onLeadTimeChange,
  sourceBadge,
  onResetDefaultTerms,
  currency,
  subtotal,
  taxAmount,
  totalAmount,
  companyIsPkp,
  effectiveTaxRate,
  extraTotalsNode,
}: OrderTermsFormSectionProps) {
  return (
    <div className="border-t border-slate-100 pt-5">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(270px,0.85fr)] gap-4 items-start">
        {/* Bottom-Left: Terms & Conditions */}
        <section
          aria-label="Terms & Conditions"
          className="rounded-xl border border-slate-200 bg-slate-50/65 p-4 space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#0B1B3A]">
                Terms &amp; Conditions
              </h4>
              {sourceBadge && (
                <span className="inline-flex items-center rounded-md bg-[#EBF3FA] border border-[#BFD9EF] px-2 py-0.5 text-[10.5px] font-semibold text-[#154C7E]">
                  {sourceBadge}
                </span>
              )}
            </div>
            {onResetDefaultTerms && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResetDefaultTerms}
                className="h-7 px-2 text-[11px] text-slate-600 hover:text-[#0B1B3A]"
              >
                <RotateCcw className="h-3 w-3" />
                Reset Default B2B
              </Button>
            )}
          </div>

          {docType === 'PURCHASE_ORDER' && (
            <div
              role="note"
              className="rounded-lg border border-amber-300/90 bg-amber-50/90 px-3 py-2 text-[11.5px] text-amber-950 flex items-start gap-2"
            >
              <FileCheck2 className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Catatan Wajib Dokumen Supplier: </span>
                <span>{MANDATORY_PO_ATTACHMENT_NOTE}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-payment-term`}>Payment Term</Label>
              <NativeSelect
                id={`${idPrefix}-payment-term`}
                value={paymentTerm}
                onChange={(e) => onPaymentTermChange(e.target.value as PaymentTermOption)}
              >
                {PAYMENT_TERM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-incoterm`}>Incoterms</Label>
              <NativeSelect
                id={`${idPrefix}-incoterm`}
                value={incoterm}
                onChange={(e) => onIncotermChange(e.target.value)}
              >
                {INCOTERM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {paymentTerm === 'Custom' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${idPrefix}-payment-custom`}>
                  Detail Payment Term Custom
                </Label>
                <Input
                  id={`${idPrefix}-payment-custom`}
                  required
                  placeholder="Contoh: DP 30% + Pelunasan 70% TOP 21 Hari Kalender setelah BAST"
                  value={paymentTermCustom}
                  onChange={(e) => onPaymentTermCustomChange(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${idPrefix}-delivery-loc`}>Lokasi Pengiriman (Incoterms)</Label>
              <Input
                id={`${idPrefix}-delivery-loc`}
                required
                placeholder="Alamat gudang pembeli / titik serah terima barang..."
                value={deliveryLocation}
                onChange={(e) => onDeliveryLocationChange(e.target.value)}
              />
            </div>

            {docType === 'QUOTATION' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-validity-period`}>
                    Validity Period (Masa Berlaku)
                  </Label>
                  <Input
                    id={`${idPrefix}-validity-period`}
                    required
                    placeholder="Contoh: 14 Hari Kalender"
                    value={validityPeriod}
                    onChange={(e) => onValidityPeriodChange?.(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-lead-time`}>
                    Lead Time (Estimasi Kirim)
                  </Label>
                  <Input
                    id={`${idPrefix}-lead-time`}
                    required
                    placeholder="Contoh: 3-5 Hari Kerja setelah PO diterima"
                    value={leadTime}
                    onChange={(e) => onLeadTimeChange?.(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-terms-text`}>
              Terms &amp; Conditions (Syarat &amp; Ketentuan B2B)
            </Label>
            <Textarea
              id={`${idPrefix}-terms-text`}
              rows={4}
              value={termsAndConditions}
              onChange={(e) => onTermsAndConditionsChange(e.target.value)}
              placeholder="Syarat pembayaran, ketentuan pengiriman, garansi/klaim, dan klausul B2B..."
              className="bg-white text-xs leading-relaxed min-h-[104px]"
            />
          </div>
        </section>

        {/* Bottom-Right: Ringkasan Total */}
        <aside
          aria-label="Ringkasan Total Dokumen"
          className="rounded-xl border border-[#D8E2EF] bg-[#F4F7FB] p-4 space-y-3"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-[#0B1B3A]">
            Ringkasan Total
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2 text-slate-600">
              <span>Subtotal (DPP)</span>
              <span className="font-mono tabular-nums font-semibold text-[#0B1B3A]">
                {formatCurrency(subtotal, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-slate-600">
              <span>{companyIsPkp ? `PPN (${effectiveTaxRate}%)` : 'PPN (Non-PKP 0%)'}</span>
              <span className="font-mono tabular-nums font-semibold text-[#0B1B3A]">
                {formatCurrency(taxAmount, currency)}
              </span>
            </div>
            <div className="border-t border-slate-300/80 pt-2.5 flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-[#0B1B3A]">Grand Total</span>
              <span className="text-base font-bold font-mono tabular-nums text-[#0B1B3A]">
                {formatCurrency(totalAmount, currency)}
              </span>
            </div>
          </div>

          {extraTotalsNode && (
            <div className="border-t border-slate-200/90 pt-2.5 text-[11.5px] space-y-1.5">
              {extraTotalsNode}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
