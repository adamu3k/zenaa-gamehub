import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { METHOD_LABEL, parseMoney, toMajorString } from '../lib/format';
import { ErrorBox, Field, Modal, Segmented } from './ui';

export const METHODS = ['cash', 'card', 'bank_transfer', 'mobile_money', 'wallet'] as const;
export type Method = (typeof METHODS)[number];
export type TenderPayload = { paymentMethod?: Method; paymentReference?: string; payments?: { method: Method; amount: number; reference?: string }[] };

const momoRef = (network: string, id: string) => [network.trim(), id.trim()].filter(Boolean).join(' · ') || undefined;

/** Network + transaction ID inputs for a mobile-money payment. */
export function MomoFields({ network, id, onNetwork, onId, compact }: { network: string; id: string; onNetwork(v: string): void; onId(v: string): void; compact?: boolean }) {
  const { settings } = useApp();
  const providers = settings.mobileMoneyProviders ?? [];
  const net = (
    <select className="select" value={network} onChange={(e) => onNetwork(e.target.value)} aria-label="Mobile money network">
      <option value="">Network…</option>
      {providers.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
      {network && !providers.includes(network) && <option value={network}>{network}</option>}
    </select>
  );
  const txn = (
    <input className="input" value={id} onChange={(e) => onId(e.target.value)} placeholder={settings.requireMomoReference ? 'Transaction ID (required)' : 'Transaction ID'} aria-label="Transaction ID" />
  );
  if (compact)
    return (
      <div className="toolbar" style={{ flexWrap: 'nowrap', paddingLeft: 12 }}>
        <div style={{ width: 160 }}>{net}</div>
        <div style={{ flex: 1 }}>{txn}</div>
      </div>
    );
  return (
    <>
      <Field label="Network">{net}</Field>
      <Field label="Transaction ID">{txn}</Field>
    </>
  );
}

export const KIND_LABEL: Record<string, string> = {
  session: 'Session',
  extension: 'Extension',
  sale: 'Sale',
  deposit: 'Wallet top-up',
  withdrawal: 'Wallet withdrawal',
  refund: 'Refund',
  cash_in: 'Cash in',
  cash_out: 'Cash out',
};

/** Opens the printable 80 mm receipt in a small window (must be called from a click). */
export function openReceipt(type: 'session' | 'payment', id: string) {
  window.open(`/receipt/${type}/${id}`, '_blank', 'width=420,height=720');
}

export function ReceiptButton({ type, id, label = 'Receipt' }: { type: 'session' | 'payment'; id: string; label?: string }) {
  return (
    <button type="button" className="btn btn-sm" onClick={() => openReceipt(type, id)}>
      <Printer size={14} /> {label}
    </button>
  );
}

/** Text input for an amount in major units; returns the parsed minor units (or null). */
export function MoneyInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange(v: string): void; placeholder?: string; autoFocus?: boolean }) {
  return <input className="input" inputMode="decimal" autoFocus={autoFocus} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function MethodSelect({ value, onChange, walletOk, walletLabel }: { value: Method; onChange(m: Method): void; walletOk: boolean; walletLabel?: string }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as Method)}>
      {METHODS.map((x) => (
        <option key={x} value={x} disabled={x === 'wallet' && !walletOk}>
          {METHOD_LABEL[x]}
          {x === 'wallet' && walletLabel ? ` (${walletLabel})` : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * Payment entry for any amount owed: one method (with cash-received → change), or a split across methods.
 * With `allowPartial` (settling a tab) the total may be less than what is owed.
 */
export function useTender(due: number, opts: { customer?: { id: string; balance?: number } | null; allowPartial?: boolean } = {}) {
  const { settings, money } = useApp();
  const mu = settings.currencyMinorUnits;
  const walletOk = !!opts.customer;
  const walletLabel = opts.customer?.balance != null ? money(opts.customer.balance) : undefined;
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [method, setMethod] = useState<Method>('cash');
  const [received, setReceived] = useState('');
  const [partial, setPartial] = useState('');
  const defaultNet = settings.mobileMoneyProviders?.[0] ?? '';
  const [net, setNet] = useState(defaultNet);
  const [txn, setTxn] = useState('');
  type Row = { method: Method; amount: string; net: string; txn: string };
  const [rows, setRows] = useState<Row[]>([
    { method: walletOk ? 'wallet' : 'cash', amount: '', net: defaultNet, txn: '' },
    { method: walletOk ? 'cash' : 'mobile_money', amount: '', net: defaultNet, txn: '' },
  ]);
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const missingRef = (m: Method, id: string) => m === 'mobile_money' && settings.requireMomoReference && id.trim().length < 4;

  let payload: TenderPayload = {};
  let total = 0;
  let error: string | null = null;

  if (due <= 0) {
    // nothing to pay
  } else if (mode === 'single') {
    const reference = method === 'mobile_money' ? momoRef(net, txn) : undefined;
    if (missingRef(method, txn)) error = 'Enter the mobile money transaction ID';
    else if (opts.allowPartial && partial.trim()) {
      const a = parseMoney(partial, mu);
      if (a == null || a <= 0) error = 'Enter a valid amount';
      else if (a > due) error = `At most ${money(due)} is owed`;
      else {
        total = a;
        payload = { payments: [{ method, amount: a, reference }] };
      }
    } else {
      total = due;
      payload = { paymentMethod: method, paymentReference: reference };
    }
  } else {
    const parsed = rows.map((r) => ({
      method: r.method,
      amount: r.amount.trim() ? parseMoney(r.amount, mu) : 0,
      reference: r.method === 'mobile_money' ? momoRef(r.net, r.txn) : undefined,
      missing: missingRef(r.method, r.txn),
    }));
    if (parsed.some((p) => p.amount == null || p.amount < 0)) error = 'One of the amounts is not valid';
    else if (parsed.some((p) => (p.amount ?? 0) > 0 && p.missing)) error = 'Enter the mobile money transaction ID';
    else {
      const list = parsed.filter((p) => (p.amount ?? 0) > 0).map(({ method, amount, reference }) => ({ method, amount: amount!, reference }));
      total = list.reduce((a, p) => a + p.amount, 0);
      if (!list.length) error = 'Enter at least one amount';
      else if (total > due) error = `Split adds up to ${money(total)} — only ${money(due)} is owed`;
      else if (total < due && !opts.allowPartial) error = `Split adds up to ${money(total)} — ${money(due - total)} still to allocate`;
      payload = { payments: list };
    }
  }
  const walletUsed =
    mode === 'single'
      ? method === 'wallet'
        ? total
        : 0
      : rows.filter((r) => r.method === 'wallet').reduce((a, r) => a + (parseMoney(r.amount, mu) ?? 0), 0);
  if (!error && opts.customer?.balance != null && walletUsed > opts.customer.balance) error = `Wallet balance is only ${money(opts.customer.balance)}`;
  if (!error && !walletOk && walletUsed > 0) error = 'Wallet needs a registered customer';

  const receivedMinor = parseMoney(received, mu);
  const change = mode === 'single' && method === 'cash' && receivedMinor != null ? receivedMinor - total : null;

  const fillRest = (i: number) => {
    const others = rows.reduce((a, r, j) => (j === i ? a : a + (parseMoney(r.amount, mu) ?? 0)), 0);
    const rest = Math.max(0, due - others);
    setRows(rows.map((r, j) => (j === i ? { ...r, amount: toMajorString(rest, mu) } : r)));
  };

  const ui: ReactNode =
    due <= 0 ? null : (
      <>
        <Field label="Payment">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'single', label: 'One method' },
              { value: 'split', label: 'Split payment' },
            ]}
          />
        </Field>
        {mode === 'single' ? (
          <div className="form-grid">
            <Field label="Method">
              <MethodSelect value={method} onChange={setMethod} walletOk={walletOk} walletLabel={walletLabel} />
            </Field>
            {method === 'mobile_money' && <MomoFields network={net} id={txn} onNetwork={setNet} onId={setTxn} />}
            {opts.allowPartial ? (
              <Field label={`Amount (${settings.currencyCode})`} hint={`Leave blank to pay the full ${money(due)}`}>
                <MoneyInput value={partial} onChange={setPartial} placeholder={toMajorString(due, mu)} />
              </Field>
            ) : (
              method === 'cash' && (
                <Field
                  label={`Cash received (${settings.currencyCode})`}
                  hint={change == null ? 'Optional — shows the change to give' : change < 0 ? `${money(-change)} short` : `Change: ${money(change)}`}
                >
                  <MoneyInput value={received} onChange={setReceived} placeholder={toMajorString(due, mu)} />
                </Field>
              )
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
                  <div style={{ flex: 1 }}>
                    <MethodSelect value={r.method} onChange={(m) => setRow(i, { method: m })} walletOk={walletOk} walletLabel={walletLabel} />
                  </div>
                  <div style={{ width: 140 }}>
                    <MoneyInput value={r.amount} onChange={(v) => setRow(i, { amount: v })} placeholder="0" />
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => fillRest(i)} title="Fill the remaining amount">
                    Rest
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
                {r.method === 'mobile_money' && <MomoFields compact network={r.net} id={r.txn} onNetwork={(v) => setRow(i, { net: v })} onId={(v) => setRow(i, { txn: v })} />}
              </div>
            ))}
            {rows.length < 6 && (
              <div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRows([...rows, { method: 'cash', amount: '', net: defaultNet, txn: '' }])}>
                  <Plus size={14} /> Add method
                </button>
              </div>
            )}
          </div>
        )}
        {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}
      </>
    );

  return { ui, payload, total, valid: due <= 0 || !error };
}

/** Refund money taken for a session: unused prepaid time, a partial amount, or everything (void). */
export function RefundModal({ session, onClose }: { session: any; onClose(): void }) {
  const { settings, money, toast } = useApp();
  const qc = useQueryClient();
  const mu = settings.currencyMinorUnits;
  const suggested = session.unused?.amount > 0 ? session.unused.amount : session.refundable;
  const [amount, setAmount] = useState(toMajorString(suggested, mu));
  const [method, setMethod] = useState<Exclude<Method, 'wallet'>>('cash');
  const [reason, setReason] = useState(session.unused?.amount > 0 ? `Unused time (${session.unused.unusedMinutes} min)` : '');
  const parsed = parseMoney(amount, mu);
  const paidByWallet = (session.payments ?? []).some((p: any) => p.method === 'wallet' && p.amount > 0);
  const m = useMutation({
    mutationFn: () => {
      if (parsed == null || parsed <= 0) throw new Error('Enter a valid amount');
      return post(`/api/sessions/${session.id}/refund`, { amount: parsed, method, reason });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['session', session.id] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['shift'] });
      toast('success', `Refunded ${money(r.amount)}`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Refund — session #${session.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={m.isPending || parsed == null || parsed <= 0 || parsed > session.refundable || reason.trim().length < 3} onClick={() => m.mutate()}>
            Refund {parsed ? money(parsed) : ''}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <dl className="kv">
        <dt>Paid</dt>
        <dd>{money(session.paidAmount)}</dd>
        <dt>Already refunded</dt>
        <dd>{money(session.refundedAmount)}</dd>
        <dt>Refundable</dt>
        <dd>{money(session.refundable)}</dd>
        {session.unused?.amount > 0 && (
          <>
            <dt>Unused time ({session.unused.unusedMinutes} min)</dt>
            <dd>{money(session.unused.amount)}</dd>
          </>
        )}
      </dl>
      <Field label={`Amount (${settings.currencyCode})`}>
        <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
          {session.unused?.amount > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setAmount(toMajorString(session.unused.amount, mu))}>
              Unused
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setAmount(toMajorString(session.refundable, mu))}>
            All (void)
          </button>
        </div>
      </Field>
      <Field label="Give back by" hint={paidByWallet ? 'Money paid from the wallet always goes back to the wallet.' : undefined}>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value as any)}>
          {METHODS.filter((x) => x !== 'wallet').map((x) => (
            <option key={x} value={x}>
              {METHOD_LABEL[x]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason (required)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Controller fault, left early" />
      </Field>
    </Modal>
  );
}

/** Take payment against an ended session's unpaid balance (a tab). */
export function SettleModal({ session, customer, onClose }: { session: any; customer?: { id: string; balance?: number } | null; onClose(): void }) {
  const { money, toast } = useApp();
  const qc = useQueryClient();
  const due = session.netAmount - session.paidAmount;
  const tender = useTender(due, { customer: customer ?? (session.customerId ? { id: session.customerId } : null), allowPartial: true });
  const m = useMutation({
    mutationFn: () => post(`/api/sessions/${session.id}/settle`, tender.payload),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['tabs'] });
      qc.invalidateQueries({ queryKey: ['session', session.id] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      toast('success', r.balanceDue > 0 ? `Received — ${money(r.balanceDue)} still owed` : 'Tab settled in full');
      onClose();
    },
  });
  return (
    <Modal
      title={`Settle tab — session #${session.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!tender.valid || m.isPending} onClick={() => m.mutate()}>
            Receive {money(tender.total)}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="total-row">
        <span>Owed</span>
        <span>{money(due)}</span>
      </div>
      {tender.ui}
    </Modal>
  );
}
