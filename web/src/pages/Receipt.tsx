import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { KIND_LABEL } from '../components/money';
import { get } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, formatDuration, formatMoney, METHOD_LABEL } from '../lib/format';

/** 80 mm thermal-printer friendly; "Save as PDF" in the print dialog gives a PDF copy. */
const CSS = `
@page { size: 80mm auto; margin: 3mm; }
html, body { background: #fff !important; color: #000 !important; }
.receipt { width: 72mm; margin: 0 auto; padding: 8px 0; font: 12px/1.35 ui-monospace, 'Cascadia Mono', Consolas, monospace; color: #000; }
.receipt h1 { font-size: 15px; text-align: center; margin: 0 0 2px; letter-spacing: .04em; }
.receipt .c { text-align: center; }
.receipt .row { display: flex; justify-content: space-between; gap: 8px; }
.receipt .row span:last-child { text-align: right; white-space: nowrap; }
.receipt hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.receipt .big { font-size: 15px; font-weight: 700; }
.receipt .muted { color: #333; }
.receipt-actions { display: flex; gap: 8px; justify-content: center; margin: 12px 0; font-family: system-ui, sans-serif; }
.receipt-actions button { padding: 8px 14px; border: 1px solid #999; background: #f4f4f4; border-radius: 6px; cursor: pointer; }
@media print { .receipt-actions { display: none; } }
`;

const Row = ({ l, r, cls }: { l: ReactNode; r: ReactNode; cls?: string }) => (
  <div className={`row ${cls ?? ''}`}>
    <span>{l}</span>
    <span>{r}</span>
  </div>
);

export function ReceiptPage() {
  const { type, id } = useParams();
  const { settings: appSettings } = useApp();
  const url = type === 'session' ? `/api/receipts/session/${id}` : type === 'payment' ? `/api/receipts/payment/${id}` : `/api/shifts/${id}`;
  const q = useQuery({ queryKey: ['receipt', type, id], queryFn: () => get(url) });
  const settings = q.data?.settings ?? appSettings;
  const money = (m: number | null | undefined) => formatMoney(m, settings);

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    if (q.data) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [q.data]);

  if (q.error) return <div style={{ padding: 20 }}>{(q.error as Error).message}</div>;
  if (!q.data) return <div style={{ padding: 20 }}>Preparing receipt…</div>;
  const d = q.data;

  const header = (
    <>
      <h1>{settings.centerName}</h1>
      {(settings as any).receiptHeader && <div className="c" style={{ whiteSpace: 'pre-line' }}>{(settings as any).receiptHeader}</div>}
      <hr />
    </>
  );
  const footer = (
    <>
      <hr />
      {(settings as any).receiptFooter && <div className="c" style={{ whiteSpace: 'pre-line' }}>{(settings as any).receiptFooter}</div>}
      <div className="c muted">Printed {formatDateTime(d.printedAt ?? new Date())}</div>
    </>
  );

  let body: ReactNode = null;
  if (type === 'session') {
    const s = d.session;
    const percentPart = s.discountAmount - s.promoDiscount - s.manualDiscount;
    const refunds = d.payments.filter((p: any) => p.kind === 'refund');
    const paid = d.payments.filter((p: any) => p.kind !== 'refund');
    body = (
      <>
        <Row l={<b>Receipt</b>} r={`Session #${s.number}`} />
        <Row l="Station" r={`${s.stationName} (${s.stationCode})`} />
        <Row l="Customer" r={d.customer ? `${d.customer.name}` : 'Walk-in'} />
        {d.customer && <Row l="Member ID" r={d.customer.code} />}
        <Row l="Cashier" r={d.cashierName} />
        <hr />
        <Row l="Plan" r={s.planName} />
        <Row l="Start" r={formatDateTime(s.startedAt)} />
        <Row l="End" r={s.endedAt ? formatDateTime(s.endedAt) : 'In progress'} />
        <Row l="Time played" r={formatDuration(s.activeSeconds)} />
        <Row l="Billed" r={`${s.billedMinutes} min`} />
        <hr />
        <Row l="Charge" r={money(s.status === 'ended' ? s.grossAmount : s.liveGrossAmount)} />
        {percentPart > 0 && <Row l={`${s.happyHourId ? 'Happy hour' : 'Member'} ${s.discountPercent}%`} r={`-${money(percentPart)}`} />}
        {s.promoDiscount > 0 && <Row l="Promo code" r={`-${money(s.promoDiscount)}`} />}
        {s.manualDiscount > 0 && <Row l="Discount" r={`-${money(s.manualDiscount)}`} />}
        <Row cls="big" l="TOTAL" r={money(s.status === 'ended' ? s.netAmount : s.liveNetAmount)} />
        <hr />
        {paid.map((p: any) => (
          <div key={p.id}>
            <Row l={`${METHOD_LABEL[p.method]}${p.kind === 'extension' ? ' (extension)' : ''}`} r={money(p.amount)} />
            {p.reference && <div className="muted">  Ref: {p.reference}</div>}
          </div>
        ))}
        {refunds.map((p: any) => (
          <Row key={p.id} l={`Refund (${METHOD_LABEL[p.method]})`} r={money(p.amount)} />
        ))}
        {s.netAmount - s.paidAmount > 0 && s.status === 'ended' && <Row cls="big" l="OWED (tab)" r={money(s.netAmount - s.paidAmount)} />}
        {d.customer && (
          <>
            <hr />
            <Row l="Wallet balance" r={money(d.customer.walletBalance)} />
            <Row l="Loyalty points" r={d.customer.points} />
          </>
        )}
      </>
    );
  } else if (type === 'payment') {
    const p = d.payment;
    body = (
      <>
        <Row l={<b>{KIND_LABEL[p.kind] ?? p.kind}</b>} r={`#${p.number}`} />
        <Row l="Date" r={formatDateTime(p.createdAt)} />
        {d.customer && <Row l="Customer" r={`${d.customer.name} ${d.customer.code}`} />}
        <Row l="Staff" r={p.staffName} />
        {p.note && <Row l="Note" r={p.note} />}
        <hr />
        <Row cls="big" l={METHOD_LABEL[p.method]} r={money(p.amount)} />
        {p.reference && <Row l="Reference" r={p.reference} />}
        {d.customer && <Row l="New wallet balance" r={money(d.customer.walletBalance)} />}
      </>
    );
  } else {
    // Shift Z-report
    const s = d;
    const sm = s.summary ?? { byMethod: {}, byKind: {} };
    body = (
      <>
        <div className="c">
          <b>{s.closedAt ? 'SHIFT Z-REPORT' : 'SHIFT X-REPORT (open)'}</b>
        </div>
        <Row l="Staff" r={s.staffName} />
        <Row l="Opened" r={formatDateTime(s.openedAt)} />
        <Row l="Closed" r={s.closedAt ? formatDateTime(s.closedAt) : '—'} />
        <hr />
        <div>
          <b>By method</b>
        </div>
        {Object.entries(sm.byMethod as Record<string, number>).map(([k, v]) => (
          <Row key={k} l={METHOD_LABEL[k] ?? k} r={money(v)} />
        ))}
        <hr />
        <div>
          <b>By type</b>
        </div>
        {Object.entries(sm.byKind as Record<string, number>).map(([k, v]) => (
          <Row key={k} l={KIND_LABEL[k] ?? k} r={money(v)} />
        ))}
        <Row l="Sales" r={money(sm.sales)} />
        <Row l="Refunds" r={`-${money(sm.refunds)}`} />
        <Row cls="big" l="Net revenue" r={money(sm.netRevenue)} />
        <hr />
        <Row l="Opening float" r={money(s.openingFloat)} />
        <Row l="Expected cash" r={money(s.expectedCash)} />
        {s.countedCash != null && <Row l="Counted cash" r={money(s.countedCash)} />}
        {s.variance != null && <Row cls="big" l={s.variance === 0 ? 'Balanced' : s.variance > 0 ? 'OVER' : 'SHORT'} r={money(s.variance)} />}
        <Row l="Transactions" r={sm.transactions} />
        {s.notes && <div style={{ whiteSpace: 'pre-wrap' }}>Notes: {s.notes}</div>}
        <br />
        <div>Signature: ____________________</div>
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="receipt-actions">
        <button onClick={() => window.print()}>Print again</button>
        <button onClick={() => window.close()}>Close</button>
      </div>
      <div className="receipt">
        {header}
        {body}
        {footer}
      </div>
    </>
  );
}
