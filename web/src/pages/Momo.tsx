import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquareText, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';
import { CustomerPicker } from './Stations';

type Tab = 'waiting' | 'sms' | 'history' | 'outbox';

const STATUS_BADGE: Record<string, string> = { pending: 'badge-warning', confirmed: 'badge-success', rejected: 'badge-danger', expired: '' };

/**
 * MoMo inbox: customers' "I sent MoMo" top-ups from the portal and the SMS the venue's MoMo phone forwarded.
 * Most are credited automatically when the SMS matches; the rest wait here for one tap.
 */
export function MomoPage() {
  const { can, settings } = useApp();
  const [tab, setTab] = useState<Tab>('waiting');
  const waiting = useQuery({ queryKey: ['momo', 'requests', 'waiting'], queryFn: () => get<any[]>('/api/momo/requests?status=pending,expired&limit=100'), refetchInterval: 30_000 });
  const sms = useQuery({ queryKey: ['momo', 'sms', 'unmatched'], queryFn: () => get<any[]>('/api/momo/sms?status=unmatched&limit=100'), refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ['momo', 'requests', 'history'], queryFn: () => get<any[]>('/api/momo/requests?status=confirmed,rejected&limit=200'), enabled: tab === 'history' });
  const noSetup = settings.momoAccounts.length === 0;
  return (
    <>
      <PageHeader
        title="MoMo inbox"
        subtitle="Customers top up their wallet by sending MoMo with a reference code. When your MoMo phone forwards the 'Payment received' SMS, ZENAA credits them automatically; anything that doesn't match waits here."
      />
      {noSetup && (
        <div className="alert alert-warning">
          No MoMo number set up yet, so customers can't start a MoMo top-up.{' '}
          {can('settings.manage') ? <Link to="/settings#momo">Settings → MoMo</Link> : 'Ask an administrator (Settings → MoMo).'} Guide: Help → 18.
        </div>
      )}
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'waiting', label: `Waiting (${waiting.data?.length ?? 0})` },
            { value: 'sms', label: `Unclaimed SMS (${sms.data?.length ?? 0})` },
            { value: 'history', label: 'History' },
            { value: 'outbox', label: 'Thank-you SMS' },
          ]}
        />
      </div>
      {tab === 'waiting' && <RequestTable rows={waiting.data} loading={waiting.isLoading} actions />}
      {tab === 'sms' && <SmsTable rows={sms.data} loading={sms.isLoading} />}
      {tab === 'history' && <RequestTable rows={history.data} loading={history.isLoading} />}
      {tab === 'outbox' && <Outbox />}
    </>
  );
}

function RequestTable({ rows, loading, actions }: { rows?: any[]; loading: boolean; actions?: boolean }) {
  const { money } = useApp();
  const [confirming, setConfirming] = useState<any>(null);
  const [rejecting, setRejecting] = useState<any>(null);
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Customer</th>
              <th>Code</th>
              <th className="right">Amount</th>
              <th>Transaction ID</th>
              <th>Status</th>
              {actions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="dim">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && !rows?.length && (
              <tr>
                <td colSpan={7} className="dim">
                  {actions ? 'Nothing waiting. 🎉' : 'Nothing yet.'}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.createdAt)}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.customerName}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {r.customerCode} · {r.customerPhone ?? ''}
                  </div>
                </td>
                <td className="mono">{r.code}</td>
                <td className="right num">{money(r.amount)}</td>
                <td className="mono">
                  {r.txnId ?? <span className="dim">—</span>}
                  {r.sms && (
                    <div className="dim" style={{ fontSize: 12, maxWidth: 320, whiteSpace: 'normal' }} title={r.sms.body}>
                      <MessageSquareText size={12} /> SMS: {money(r.sms.amount)} {r.sms.payerName ? `from ${r.sms.payerName}` : ''}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? ''}`}>{r.status === 'expired' ? 'waiting (old)' : r.status}</span>
                  {r.confirmedVia && <div className="dim" style={{ fontSize: 12 }}>{r.confirmedVia === 'sms' ? 'by SMS' : 'by staff'}</div>}
                  {r.note && (
                    <div style={{ fontSize: 12, color: 'var(--warning)', whiteSpace: 'normal', maxWidth: 260 }}>{r.note}</div>
                  )}
                </td>
                {actions && (
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => setConfirming(r)}>
                      <Check size={14} /> Received
                    </button>{' '}
                    <button className="btn btn-sm btn-ghost" onClick={() => setRejecting(r)}>
                      <X size={14} /> Reject
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirming && <ConfirmModal r={confirming} onClose={() => setConfirming(null)} />}
      {rejecting && <RejectModal r={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function ConfirmModal({ r, onClose }: { r: any; onClose(): void }) {
  const { money, toast } = useApp();
  const qc = useQueryClient();
  const [txn, setTxn] = useState(r.txnId ?? r.sms?.txnId ?? '');
  const m = useMutation({
    mutationFn: () => post(`/api/momo/requests/${r.id}/confirm`, { txnId: txn || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['momo'] });
      toast('success', `${money(r.amount)} added to ${r.customerName}'s wallet`);
      onClose();
    },
  });
  return (
    <Modal
      title="Confirm MoMo received"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>
            Credit {money(r.amount)}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Check the venue MoMo phone: did <b>{money(r.amount)}</b> arrive with reference <b className="mono">{r.code}</b>
        {r.txnId ? (
          <>
            {' '}
            or transaction ID <b className="mono">{r.txnId}</b>
          </>
        ) : null}
        ? Only confirm money you can see on the phone.
      </p>
      {r.sms && <div className="alert alert-info" style={{ whiteSpace: 'pre-wrap' }}>{r.sms.body}</div>}
      <Field label="Transaction ID (from the MoMo message)">
        <input className="input mono" value={txn} onChange={(e) => setTxn(e.target.value.toUpperCase())} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function RejectModal({ r, onClose }: { r: any; onClose(): void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => post(`/api/momo/requests/${r.id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['momo'] });
      onClose();
    },
  });
  return (
    <Modal
      title={`Reject top-up ${r.code}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            Reject
          </button>
        </>
      }
    >
      <Field label="Reason (the customer sees it)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No money received — please see the counter" autoFocus />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function SmsTable({ rows, loading }: { rows?: any[]; loading: boolean }) {
  const { money } = useApp();
  const qc = useQueryClient();
  const [assigning, setAssigning] = useState<any>(null);
  const ignore = useMutation({ mutationFn: (id: string) => post(`/api/momo/sms/${id}/ignore`), onSuccess: () => qc.invalidateQueries({ queryKey: ['momo'] }) });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Money received that nobody claimed</h2>
        <span className="dim" style={{ fontSize: 13 }}>
          e.g. the customer forgot the reference code — credit it to them, or ignore it if it isn't a top-up.
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th className="right">Amount</th>
              <th>From</th>
              <th>Transaction ID</th>
              <th>Message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="dim">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && !rows?.length && (
              <tr>
                <td colSpan={6} className="dim">
                  No unclaimed messages.
                </td>
              </tr>
            )}
            {rows?.map((s) => (
              <tr key={s.id}>
                <td>{formatDateTime(s.receivedAt)}</td>
                <td className="right num">{s.amount != null ? money(s.amount) : '—'}</td>
                <td>
                  {s.payerName ?? ''} <span className="dim">{s.payerPhone ?? ''}</span>
                </td>
                <td className="mono">{s.txnId ?? '—'}</td>
                <td style={{ maxWidth: 360, whiteSpace: 'normal', fontSize: 12 }} className="dim">
                  {s.body}
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-primary" onClick={() => setAssigning(s)}>
                    Credit a customer
                  </button>{' '}
                  <button className="btn btn-sm btn-ghost" onClick={() => ignore.mutate(s.id)}>
                    Ignore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {assigning && <AssignModal s={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function AssignModal({ s, onClose }: { s: any; onClose(): void }) {
  const { money, toast } = useApp();
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<any>(null);
  const m = useMutation({
    mutationFn: () => post(`/api/momo/sms/${s.id}/assign`, { customerId: customer.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['momo'] });
      toast('success', `${money(s.amount)} added to ${customer.fullName}'s wallet`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Credit ${money(s.amount)} to a customer`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!customer || m.isPending} onClick={() => m.mutate()}>
            Credit wallet
          </button>
        </>
      }
    >
      <div className="alert alert-info" style={{ whiteSpace: 'pre-wrap' }}>
        {s.body}
      </div>
      <Field label="Customer">
        <CustomerPicker value={customer} onChange={setCustomer} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

const OUT_BADGE: Record<string, string> = { queued: 'badge-warning', sending: 'badge-warning', sent: 'badge-success', failed: 'badge-danger', expired: '' };
const OUT_LABEL: Record<string, string> = { queued: 'waiting for the phone', sending: 'sending…', sent: 'sent', failed: 'failed', expired: 'too old — not sent' };
const KIND_LABEL: Record<string, string> = { momo: 'MoMo top-up', topup: 'Counter top-up', game: 'Game paid', test: 'Test' };

/** SMS the MoMo phone sends to customers (thank-you / receipt). */
function Outbox() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['momo', 'outbox'], queryFn: () => get<any[]>('/api/momo/outbox?limit=150'), refetchInterval: 10_000 });
  const retry = useMutation({ mutationFn: (id: string) => post(`/api/momo/outbox/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ['momo', 'outbox'] }) });
  const stuck = (q.data ?? []).filter((m) => m.status === 'queued').length;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Thank-you SMS</h2>
        <span className="dim" style={{ fontSize: 13 }}>
          Sent from the MoMo phone (ZENAA MoMo 1.2+). Turn them on/off and change the words in <Link to="/settings#momo">Settings → MoMo</Link>.
        </span>
      </div>
      {stuck > 3 && (
        <div className="alert alert-warning" style={{ margin: 12 }}>
          {stuck} messages are waiting. Is the MoMo phone on, on Wi-Fi, with ZENAA MoMo 1.2 or newer open once?
        </div>
      )}
      <ErrorBox error={q.error || retry.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>To</th>
              <th>For</th>
              <th>Message</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="dim">
                  Loading…
                </td>
              </tr>
            )}
            {!q.isLoading && !q.data?.length && (
              <tr>
                <td colSpan={6} className="dim">
                  No messages yet.
                </td>
              </tr>
            )}
            {q.data?.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">{formatDateTime(m.createdAt)}</td>
                <td>
                  {m.customerName ?? '—'}
                  <div className="dim mono" style={{ fontSize: 12 }}>
                    {m.phone}
                  </div>
                </td>
                <td className="nowrap">{KIND_LABEL[m.kind] ?? m.kind}</td>
                <td style={{ maxWidth: 380, fontSize: 13 }}>{m.body}</td>
                <td>
                  <span className={`badge ${OUT_BADGE[m.status] ?? ''}`}>{OUT_LABEL[m.status] ?? m.status}</span>
                  {m.error && m.status !== 'sent' && (
                    <div className="dim" style={{ fontSize: 12 }}>
                      {m.error}
                    </div>
                  )}
                </td>
                <td>
                  {(m.status === 'failed' || m.status === 'expired') && (
                    <button className="btn btn-sm" onClick={() => retry.mutate(m.id)}>
                      Send again
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
