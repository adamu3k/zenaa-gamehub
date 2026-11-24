import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, CreditCard, KeyRound, Plus, Repeat, Search, Trash2, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MomoFields, SettleModal, useTender } from '../components/money';
import { DeleteButton } from '../components/DeleteButton';
import { ErrorBox, Field, Modal, PageHeader, StatusBadge } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, formatDuration, formatMinutes, METHOD_LABEL, parseMoney, toMajorString } from '../lib/format';

export function CustomersPage() {
  const { money, can } = useApp();
  const [term, setTerm] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['customers', 'list', term], queryFn: () => get(`/api/customers?limit=100&q=${encodeURIComponent(term)}`) });

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Profiles, wallets, membership tiers and history"
        actions={
          can('customers.manage') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Register customer
            </button>
          )
        }
      />
      <div className="card">
        <div className="card-head">
          <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 11 }} className="dim" />
            <input className="input" style={{ paddingLeft: 36 }} placeholder="Search name, phone, email or ZG-ID" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Tier</th>
                <th>Status</th>
                <th className="right">Points</th>
                <th className="right">Wallet</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No customers found
                  </td>
                </tr>
              )}
              {(q.data ?? []).map((c: any) => (
                <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)}>
                  <td className="mono dim">{c.code}</td>
                  <td style={{ fontWeight: 600 }}>{c.fullName}</td>
                  <td>{c.phone ?? '—'}</td>
                  <td>{c.tierName ? <span className="badge badge-primary">{c.tierName}</span> : '—'}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="right num">{c.points}</td>
                  <td className="right num">
                    {money(c.balance)}
                    {c.outstanding > 0 && <div style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>owes −{money(c.outstanding)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={(c) => setOpenId(c.id)} />}
      {openId && <CustomerDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function CustomerForm({ customer, onClose, onSaved }: { customer?: any; onClose(): void; onSaved?(c: any): void }) {
  const qc = useQueryClient();
  const { toast, settings } = useApp();
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => get('/api/membership-tiers') });
  const [f, setF] = useState({
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    tierId: customer?.tierId ?? '',
    notes: customer?.notes ?? '',
    gamertag: customer?.gamertag ?? '',
    psnId: customer?.psnId ?? '',
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body = { fullName: f.fullName, phone: f.phone || null, email: f.email || null, tierId: f.tierId || null, notes: f.notes || null, gamertag: f.gamertag || null, psnId: f.psnId || null };
      return customer ? patch(`/api/customers/${customer.id}`, body) : post('/api/customers', body);
    },
    onSuccess: (c: any) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', c.id] });
      toast('success', customer ? 'Customer updated' : `Registered ${c.fullName} (${c.code})`);
      onClose();
      onSaved?.(c);
    },
  });
  return (
    <Modal
      title={customer ? 'Edit customer' : 'Register customer'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!f.fullName || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="form-grid">
        <Field label="Full name" full>
          <input className="input" autoFocus value={f.fullName} onChange={set('fullName')} />
        </Field>
        <Field label="Phone" hint={settings.phonePrefix ? `Local numbers (0…) are saved with ${settings.phonePrefix}` : undefined}>
          <input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder={settings.phonePrefix ? `0… or ${settings.phonePrefix}…` : undefined} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Membership tier" full>
          <select className="select" value={f.tierId} onChange={set('tierId')}>
            <option value="">— None —</option>
            {(tiers.data ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.discountPercent}% off)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gamertag" hint="Name on the leaderboard (optional)">
          <input className="input" value={f.gamertag} onChange={set('gamertag')} placeholder="e.g. KofiKing" />
        </Field>
        <Field label="PSN ID" hint="Shared only with matched online opponents">
          <input className="input" value={f.psnId} onChange={set('psnId')} />
        </Field>
        <Field label="Notes" full>
          <textarea className="textarea" value={f.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  );
}

function CustomerDetail({ id, onClose }: { id: string; onClose(): void }) {
  const { money, can, toast, settings } = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => get(`/api/customers/${id}`) });
  const removeCharge = useMutation({
    mutationFn: (cid: string) => del(`/api/customers/charges/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer', id] }),
    onError: (e: Error) => toast('error', e.message),
  });
  const [walletOp, setWalletOp] = useState<null | 'deposit' | 'withdrawal' | 'adjustment'>(null);
  const [timeOp, setTimeOp] = useState<null | 'buy' | 'adjust'>(null);
  const [editing, setEditing] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [settling, setSettling] = useState<any>(null);
  const [paystackOpen, setPaystackOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [payAccount, setPayAccount] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [portalCode, setPortalCode] = useState<any>(null);
  const paystack = useQuery({ queryKey: ['paystack-status'], queryFn: () => get('/api/paystack/status'), staleTime: 60_000 });
  const issueCode = useMutation({
    mutationFn: () => post(`/api/customers/${id}/portal-code`),
    onSuccess: (r) => {
      setPortalCode(r);
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e: Error) => toast('error', e.message),
  });
  const portalAccess = useMutation({
    mutationFn: (on: boolean) => patch(`/api/customers/${id}`, { portalEnabled: on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer', id] }),
    onError: (e: Error) => toast('error', e.message),
  });
  const status = useMutation({
    mutationFn: (s: 'active' | 'suspended') => patch(`/api/customers/${id}`, { status: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e: Error) => toast('error', e.message),
  });
  const c = q.data;
  return (
    <Modal wide title={c ? `${c.fullName} · ${c.code}` : 'Customer'} onClose={onClose}>
      <ErrorBox error={q.error} />
      {c && (
        <>
          <div className="grid stats">
            <div className="card stat">
              <span className="stat-label">{c.outstanding > 0 ? 'Main balance' : 'Wallet'}</span>
              <span className="stat-value" style={{ color: c.balance - (c.outstanding ?? 0) < 0 ? 'var(--danger)' : undefined }}>
                {c.balance - (c.outstanding ?? 0) < 0 ? `−${money(c.outstanding - c.balance)}` : money(c.balance - (c.outstanding ?? 0))}
              </span>
              {c.outstanding > 0 && (
                <span className="stat-sub">
                  Wallet {money(c.balance)} · <b style={{ color: 'var(--danger)' }}>owes {money(c.outstanding)}</b>
                </span>
              )}
            </div>
            <div className="card stat">
              <span className="stat-label">Saved time</span>
              <span className="stat-value" style={{ color: c.savedSeconds >= 60 ? 'var(--success)' : undefined }}>
                {formatMinutes(Math.floor(c.savedSeconds / 60))}
              </span>
              {(c.savedTime ?? []).length > 0 && (
                <span className="stat-sub">
                  {(c.savedTime as any[]).map((t) => `${t.name} ${formatMinutes(Math.floor(t.seconds / 60))}`).join(' · ')}
                </span>
              )}
              <span className="stat-sub">
                {c.savedSeconds >= 60 ? 'Continue it from Start session' : 'Nothing saved'}
                {can('customers.time') && (c.savedTime ?? []).some((t: any) => t.categoryId) && (
                  <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px', marginLeft: 4 }} onClick={() => setConvertOpen(true)} title="Change saved time to another station type">
                    <Repeat size={12} /> Type
                  </button>
                )}
                {can('customers.time') && (
                  <>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px', marginLeft: 4 }} onClick={() => setTimeOp('buy')}>
                      Add
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px' }} onClick={() => setTimeOp('adjust')}>
                      Change
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="card stat">
              <span className="stat-label">Points</span>
              <span className="stat-value">{c.points}</span>
              <span className="stat-sub">{c.tierName ? `${c.tierName} · ${c.tierDiscount}% off` : 'No tier'}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Owes (on account)</span>
              <span className="stat-value" style={{ color: c.outstanding > 0 ? 'var(--warning)' : undefined }}>
                {money(c.outstanding)}
              </span>
              <span className="stat-sub">
                Limit {c.creditLimit > 0 ? money(c.creditLimit) : settings.defaultCreditLimit ? `${money(settings.defaultCreditLimit)} (default)` : 'none'}
                {can('payments.tab') && (
                  <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px', marginLeft: 4 }} onClick={() => setCreditOpen(true)}>
                    Change
                  </button>
                )}
              </span>
            </div>
            <div className="card stat">
              <span className="stat-label">Total spent</span>
              <span className="stat-value">{money(c.stats.spent)}</span>
              <span className="stat-sub">
                {c.stats.sessions} sessions · {formatDuration(c.stats.seconds)}
              </span>
            </div>
          </div>
          <div className="toolbar">
            <StatusBadge status={c.status} />
            <span className="dim">{c.phone ?? 'No phone'} · {c.email ?? 'No email'}</span>
            <div className="spacer" />
            {can('wallet.deposit') && (
              <button className="btn btn-primary btn-sm" onClick={() => setWalletOp('deposit')}>
                <Wallet size={14} /> Top up
              </button>
            )}
            {can('wallet.deposit') && paystack.data?.enabled && (
              <button className="btn btn-sm" onClick={() => setPaystackOpen(true)} title="Customer pays on their phone with card or mobile money">
                <CreditCard size={14} /> Paystack
              </button>
            )}
            {can('wallet.withdraw') && (
              <button className="btn btn-sm" onClick={() => setWalletOp('withdrawal')}>
                Withdraw
              </button>
            )}
            {can('wallet.adjust') && (
              <button className="btn btn-sm" onClick={() => setWalletOp('adjustment')}>
                Adjust
              </button>
            )}
            {can('customers.manage') && (
              <>
                <button className="btn btn-sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="btn btn-sm" onClick={() => status.mutate(c.status === 'active' ? 'suspended' : 'active')}>
                  {c.status === 'active' ? 'Suspend' : 'Reactivate'}
                </button>
                <DeleteButton
                  url={`/api/customers/${id}`}
                  what={c.fullName}
                  confirmText={`Delete ${c.fullName} (${c.code})?\n\nTheir name, phone and app account are removed. Past payments and match results stay in the reports as "Deleted customer". Customers with wallet money, saved time or an unpaid tab cannot be deleted.`}
                  refresh={[['customers']]}
                  onDone={onClose}
                />
              </>
            )}
          </div>
          <div className="card card-pad toolbar" style={{ padding: 14 }}>
            <KeyRound size={16} className="dim" />
            <div>
              <div style={{ fontWeight: 600 }}>Customer portal</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {!c.portalEnabled
                  ? 'Access switched off'
                  : c.hasPortalAccount
                    ? `Account active · last sign-in ${formatDateTime(c.portalLastLoginAt)}`
                    : c.hasActivationCode
                      ? 'Activation code issued — not used yet'
                      : 'No online account yet'}
              </div>
            </div>
            <div className="spacer" />
            {can('customers.manage') && (
              <>
                <button className="btn btn-sm" disabled={issueCode.isPending || !c.phone} title={c.phone ? undefined : 'Add a phone number first'} onClick={() => issueCode.mutate()}>
                  {c.hasPortalAccount ? 'Password reset code' : 'Give activation code'}
                </button>
                {c.hasPortalAccount && (
                  <button className="btn btn-sm btn-ghost" disabled={portalAccess.isPending} onClick={() => portalAccess.mutate(!c.portalEnabled)}>
                    {c.portalEnabled ? 'Turn access off' : 'Turn access on'}
                  </button>
                )}
              </>
            )}
          </div>
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="toolbar">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Account — pay later</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  Games played and not paid, drinks, or time added for a friend. They pay it later with cash, MoMo or their wallet.
                </div>
              </div>
              {can('payments.tab') && (
                <button className="btn btn-sm" onClick={() => setChargeOpen(true)}>
                  <Plus size={14} /> Put on account
                </button>
              )}
              {c.outstanding > 0 && can('sessions.operate') && (
                <button className="btn btn-sm btn-primary" onClick={() => setPayAccount(true)}>
                  Take payment · {money(c.outstanding)}
                </button>
              )}
            </div>
            {(c.tab ?? []).length === 0 ? (
              <span className="dim" style={{ fontSize: 13 }}>
                Nothing owed.
              </span>
            ) : (
              <div className="list">
                {(c.tab as any[]).map((t) => (
                  <div key={t.kind + t.id} className="list-item">
                    <span>
                      {t.label}
                      <div className="dim" style={{ fontSize: 12 }}>
                        {formatDateTime(t.at)}
                        {t.owed < t.amount ? ` · ${money(t.amount - t.owed)} of ${money(t.amount)} paid` : ''}
                      </div>
                    </span>
                    <span className="toolbar" style={{ flexWrap: 'nowrap' }}>
                      <strong className="num" style={{ color: 'var(--warning)' }}>{money(t.owed)}</strong>
                      {t.kind === 'charge' && t.owed === t.amount && can('payments.tab') && !t.label.includes(' added on ') && (
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Remove (put on by mistake)"
                          onClick={() => window.confirm(`Remove "${t.label}" (${money(t.amount)}) from ${c.fullName}'s account?`) && removeCharge.mutate(t.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {(c.timeLog?.length ?? 0) > 0 && (
            <>
              <h3>Saved time history</h3>
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>What</th>
                      <th>Details</th>
                      <th className="right">Time</th>
                      <th className="right">Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.timeLog.map((t: any) => (
                      <tr key={t.id}>
                        <td>{formatDateTime(t.createdAt)}</td>
                        <td>{TIME_KIND[t.kind] ?? t.kind}</td>
                        <td className="dim">{[t.planName, t.amount ? money(t.amount) : null, t.note].filter(Boolean).join(' · ')}</td>
                        <td className="right num" style={{ color: t.seconds < 0 ? 'var(--danger)' : 'var(--success)' }}>
                          {t.seconds < 0 ? '−' : '+'}
                          {formatMinutes(Math.floor(Math.abs(t.seconds) / 60))}
                        </td>
                        <td className="right num">{formatMinutes(Math.floor(t.balanceAfter / 60))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <h3>Wallet ledger</h3>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Note</th>
                  <th className="right">Amount</th>
                  <th className="right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {c.ledger.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No wallet activity
                    </td>
                  </tr>
                )}
                {c.ledger.map((t: any) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.createdAt)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
                    <td className="dim">{t.note ?? ''}</td>
                    <td className="right num" style={{ color: t.amount < 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {money(t.amount)}
                    </td>
                    <td className="right num">{money(t.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Session history</h3>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Station</th>
                  <th>Plan</th>
                  <th>Duration</th>
                  <th className="right">Paid</th>
                  <th className="right">Owed</th>
                </tr>
              </thead>
              <tbody>
                {c.sessions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No sessions yet
                    </td>
                  </tr>
                )}
                {c.sessions.map((s: any) => {
                  const owed = s.status === 'ended' ? s.netAmount - s.paidAmount : 0;
                  return (
                    <tr key={s.id}>
                      <td>{formatDateTime(s.startedAt)}</td>
                      <td>{s.stationName}</td>
                      <td>{s.rate.planName}</td>
                      <td className="mono">{s.status === 'ended' ? formatDuration(s.accumulatedSeconds) : <StatusBadge status={s.status} />}</td>
                      <td className="right num">
                        {money(s.paidAmount - s.refundedAmount)}
                        {s.refundedAmount > 0 && <div className="dim" style={{ fontSize: 11 }}>after {money(s.refundedAmount)} refund</div>}
                      </td>
                      <td className="right num">
                        {owed > 0 ? (
                          can('sessions.operate') ? (
                            <button className="btn btn-sm" onClick={() => setSettling(s)}>
                              Receive {money(owed)}
                            </button>
                          ) : (
                            money(owed)
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {walletOp && c && <WalletModal customer={c} op={walletOp} onClose={() => setWalletOp(null)} />}
      {timeOp && c && <TimeModal customer={c} op={timeOp} onClose={() => setTimeOp(null)} />}
      {paystackOpen && c && <PaystackTopupModal customer={c} onClose={() => setPaystackOpen(false)} />}
      {portalCode && c && (
        <Modal
          title="Portal activation code"
          onClose={() => setPortalCode(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setPortalCode(null)}>
              Done
            </button>
          }
        >
          <div className="qr-box">
            <div className="mono" style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.2em' }}>
              {portalCode.code}
            </div>
            <div className="muted">Valid until {formatDateTime(portalCode.expiresAt)} · can be used once</div>
          </div>
          <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>
              The customer opens <strong>{window.location.origin}/portal</strong> and taps <strong>I have a code</strong>.
            </li>
            <li>
              They enter their phone <strong>{portalCode.phone}</strong>, this code, and choose a password.
            </li>
          </ol>
        </Modal>
      )}
      {editing && c && <CustomerForm customer={c} onClose={() => setEditing(false)} />}
      {chargeOpen && c && <ChargeModal customer={c} onClose={() => setChargeOpen(false)} />}
      {payAccount && c && <PayAccountModal customer={c} onClose={() => setPayAccount(false)} />}
      {convertOpen && c && <ConvertTimeModal customer={c} onClose={() => setConvertOpen(false)} />}
      {creditOpen && c && <CreditLimitModal customer={c} onClose={() => setCreditOpen(false)} />}
      {settling && c && <SettleModal session={settling} customer={{ id: c.id, balance: c.balance }} onClose={() => setSettling(null)} />}
    </Modal>
  );
}

function CreditLimitModal({ customer, onClose }: { customer: any; onClose(): void }) {
  const { settings, money, toast } = useApp();
  const qc = useQueryClient();
  const [value, setValue] = useState(customer.creditLimit ? toMajorString(customer.creditLimit, settings.currencyMinorUnits) : '');
  const parsed = value.trim() ? parseMoney(value, settings.currencyMinorUnits) : 0;
  const m = useMutation({
    mutationFn: () => patch(`/api/customers/${customer.id}`, { creditLimit: parsed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      toast('success', parsed ? `Credit limit set to ${money(parsed)}` : 'Tabs disabled for this customer');
      onClose();
    },
  });
  return (
    <Modal
      title="Credit limit (pay later)"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={parsed == null || parsed < 0 || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="muted">
        The most {customer.fullName} may owe at any time. Leave blank or 0 to stop them paying later. They currently owe {money(customer.outstanding)}.
      </div>
      <Field label={`Credit limit (${settings.currencyCode})`}>
        <input className="input" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
      </Field>
    </Modal>
  );
}

function WalletModal({ customer, op, onClose }: { customer: any; op: 'deposit' | 'withdrawal' | 'adjustment'; onClose(): void }) {
  const { settings, money, toast } = useApp();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [net, setNet] = useState(settings.mobileMoneyProviders?.[0] ?? '');
  const [txn, setTxn] = useState('');
  const parsed = parseMoney(amount, settings.currencyMinorUnits);
  const momo = op !== 'adjustment' && method === 'mobile_money';
  const m = useMutation({
    mutationFn: () => {
      if (parsed == null || parsed === 0) throw new Error('Enter a valid amount');
      const reference = momo ? [net, txn.trim()].filter(Boolean).join(' · ') || null : null;
      return post(`/api/customers/${customer.id}/wallet`, { operation: op, amount: parsed, method: op === 'adjustment' ? undefined : method, reference, note: note || null });
    },
    onSuccess: (t: any) => {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast('success', `New balance ${money(t.balanceAfter)}`);
      onClose();
    },
  });
  const title = op === 'deposit' ? 'Top up wallet' : op === 'withdrawal' ? 'Withdraw from wallet' : 'Adjust wallet';
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={m.isPending || parsed == null || parsed === 0 || (op === 'adjustment' && !note) || (momo && op === 'deposit' && settings.requireMomoReference && txn.trim().length < 4)}
            onClick={() => m.mutate()}
          >
            Confirm
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="muted">
        {customer.fullName} · current balance <strong>{money(customer.balance)}</strong>
      </div>
      <Field label={`Amount (${settings.currencyCode})`} hint={op === 'adjustment' ? 'Use a negative amount to reduce the balance' : undefined}>
        <input className="input" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {op !== 'adjustment' && (
        <Field label={op === 'deposit' ? 'Received by' : 'Paid out by'}>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['cash', 'card', 'bank_transfer', 'mobile_money'].map((x) => (
              <option key={x} value={x}>
                {METHOD_LABEL[x]}
              </option>
            ))}
          </select>
        </Field>
      )}
      {momo && <MomoFields network={net} id={txn} onNetwork={setNet} onId={setTxn} />}
      <Field label={op === 'adjustment' ? 'Reason (required)' : 'Note'}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Counter top-up through Paystack: the customer scans the QR code and pays on their phone (card or mobile money). */
function PaystackTopupModal({ customer, onClose }: { customer: any; onClose(): void }) {
  const { settings, money, toast } = useApp();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [email, setEmail] = useState(customer.email ?? '');
  const [started, setStarted] = useState<any>(null);
  const parsed = parseMoney(amount, settings.currencyMinorUnits);
  const start = useMutation({
    mutationFn: () => post(`/api/customers/${customer.id}/paystack`, { amount: parsed, email: email.trim() }),
    onSuccess: setStarted,
  });
  const status = useQuery({
    queryKey: ['paystack-payment', started?.reference],
    queryFn: () => get(`/api/paystack/payments/${started.reference}`),
    enabled: !!started,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : 4000),
  });
  const st: string = status.data?.status ?? 'pending';
  useEffect(() => {
    if (st === 'success') {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast('success', `Paystack payment received — ${money(started.amount)} added to the wallet`);
    }
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal
      title="Top up with Paystack"
      onClose={onClose}
      footer={
        started ? (
          <button className="btn btn-primary" onClick={onClose}>
            {st === 'success' ? 'Done' : 'Close'}
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={start.isPending || parsed == null || parsed <= 0 || !email.includes('@')} onClick={() => start.mutate()}>
              Create payment
            </button>
          </>
        )
      }
    >
      <ErrorBox error={start.error} />
      {!started ? (
        <>
          <div className="muted">
            {customer.fullName} · balance <strong>{money(customer.balance)}</strong>. The customer pays on their own phone by card or mobile money; the wallet is
            credited automatically once Paystack confirms.
          </div>
          <Field label={`Amount (${settings.currencyCode})`}>
            <input className="input" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Customer email" hint="Paystack requires an email and sends the receipt there">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </>
      ) : (
        <div className="qr-box">
          {st === 'success' ? (
            <>
              <span className="badge badge-success" style={{ fontSize: 14, padding: '6px 14px' }}>
                Paid · {money(started.amount)}
              </span>
              <div className="muted">The wallet has been credited.</div>
            </>
          ) : st === 'pending' ? (
            <>
              <img src={started.qr} alt="Scan to pay with Paystack" />
              <div style={{ fontWeight: 700, fontSize: 18 }}>{money(started.amount)}</div>
              <div className="muted">Ask the customer to scan this code with their phone camera and pay. This window updates by itself.</div>
              <a className="btn btn-sm" href={started.authorizationUrl} target="_blank" rel="noreferrer">
                Open payment page on this device
              </a>
              <span className="dim" style={{ fontSize: 12 }}>Waiting for payment… ({started.reference})</span>
            </>
          ) : (
            <>
              <StatusBadge status={st} />
              <div className="muted">{status.data?.failureReason ?? 'The payment did not go through.'}</div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

const TIME_KIND: Record<string, string> = { bought: 'Bought', saved: 'Saved (left over)', used: 'Played', adjust: 'Changed by staff' };

/** Sell a package / minutes onto the customer's account, or add/remove time by hand (customers.time). */
function TimeModal({ customer, op, onClose }: { customer: any; op: 'buy' | 'adjust'; onClose(): void }) {
  const { money, toast } = useApp();
  const qc = useQueryClient();
  const plansQ = useQuery({ queryKey: ['plans'], queryFn: () => get<any[]>('/api/pricing-plans') });
  const plans = (plansQ.data ?? []).filter((p) => p.active);
  const [planId, setPlanId] = useState('');
  const [minutes, setMinutes] = useState(op === 'buy' ? '60' : '');
  const [packages, setPackages] = useState(1);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!planId && plans.length) setPlanId(plans[0].id);
  }, [plans, planId]);
  const plan = plans.find((p) => p.id === planId);
  const mins = Math.round(Number(minutes) || 0);
  let addMin = 0;
  let price = 0;
  if (op === 'buy' && plan) {
    if (plan.kind === 'package') {
      addMin = (plan.packageMinutes ?? 0) * packages;
      price = (plan.packagePrice ?? 0) * packages;
    } else {
      addMin = mins;
      price = Math.floor((mins * plan.ratePerHour * 2 + 60) / 120);
    }
  }
  const pct = customer.tierDiscount ?? 0;
  const net = price - Math.floor((price * pct * 2 + 100) / 200);
  const tender = useTender(op === 'buy' ? net : 0, { customer });
  const m = useMutation({
    mutationFn: () =>
      post(
        `/api/customers/${customer.id}/time`,
        op === 'buy'
          ? { mode: 'buy', planId, packages: plan?.kind === 'package' ? packages : undefined, minutes: plan?.kind === 'package' ? undefined : mins, note: note || null, ...tender.payload }
          : { mode: 'adjust', minutes: mins, note },
      ),
    onSuccess: (t: any) => {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast('success', `${customer.fullName} now has ${formatMinutes(Math.floor(t.balanceAfter / 60))} saved`);
      onClose();
    },
  });
  const left = Math.floor(customer.savedSeconds / 60);
  const valid = op === 'buy' ? !!plan && addMin > 0 && tender.valid : mins !== 0 && !!note.trim() && left + mins >= 0;
  return (
    <Modal
      title={op === 'buy' ? `Add time to ${customer.fullName}'s account` : `Change ${customer.fullName}'s saved time`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending || !valid} onClick={() => m.mutate()}>
            <Clock size={16} /> {op === 'buy' ? `Collect ${money(net)} & add ${formatMinutes(addMin)}` : 'Save change'}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="muted">
        Saved now: <strong>{formatMinutes(left)}</strong>. The customer continues it from <b>Start session</b> on any station, and sees it in the customer app.
      </div>
      {op === 'buy' ? (
        <>
          <Field label="Package / pricing plan">
            <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.kind === 'package' ? `${formatMinutes(p.packageMinutes ?? 0)} for ${money(p.packagePrice ?? 0)}` : `${money(p.ratePerHour)}/h`}
                </option>
              ))}
            </select>
          </Field>
          {plan?.kind === 'package' ? (
            <Field label="How many packages">
              <input className="input" style={{ width: 100 }} type="number" min={1} max={50} value={packages} onChange={(e) => setPackages(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          ) : (
            <Field label="Minutes" hint={plan && plan.billingUnitMinutes > 1 ? `Multiples of ${plan.billingUnitMinutes} minutes` : undefined}>
              <div className="toolbar">
                {[60, 120, 180, 300, 600].map((x) => (
                  <button type="button" key={x} className={`btn btn-sm ${mins === x ? 'btn-primary' : ''}`} onClick={() => setMinutes(String(x))}>
                    {formatMinutes(x)}
                  </button>
                ))}
                <input className="input" style={{ width: 100 }} type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </div>
            </Field>
          )}
          <div className="total-row">
            <span>To collect{pct > 0 ? ` (${pct}% member discount)` : ''}</span>
            <span>{money(net)}</span>
          </div>
          {tender.ui}
          <Field label="Note">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Minutes" hint="Use minus to take time off, e.g. -30">
            <input className="input" autoFocus style={{ width: 140 }} type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          {mins !== 0 && <div className="muted">New saved time: {left + mins < 0 ? 'cannot go below zero' : formatMinutes(left + mins)}</div>}
          <Field label="Reason (required)">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Gift, correction, PS5 broke mid-game" />
          </Field>
        </>
      )}
    </Modal>
  );
}

/** Puts something on the customer's account to pay later (play not paid for, drinks…). */
function ChargeModal({ customer, onClose }: { customer: any; onClose(): void }) {
  const { money, settings, toast } = useApp();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const parsed = parseMoney(amount, settings.currencyMinorUnits);
  const limit = customer.creditLimit > 0 ? customer.creditLimit : (settings.defaultCreditLimit ?? 0);
  const m = useMutation({
    mutationFn: () => post(`/api/customers/${customer.id}/charges`, { amount: parsed, note: note.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      toast('success', `${money(parsed)} put on ${customer.fullName}'s account`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Put on ${customer.fullName}'s account`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!parsed || parsed <= 0 || note.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>
            Put {parsed ? money(parsed) : ''} on account
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="form-grid">
        <Field label={`Amount (${settings.currencyCode})`}>
          <MoneyField value={amount} onChange={setAmount} />
        </Field>
        <Field label="What for">
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. PS5 1 hour, not paid · 2 drinks" />
        </Field>
      </div>
      <div className="hint">
        Owes {money(customer.outstanding)} now{limit > 0 ? ` · limit ${money(limit)}` : ' · no credit limit set (set one with "Change" above, or a default in Settings)'}.
      </div>
    </Modal>
  );
}

function MoneyField({ value, onChange }: { value: string; onChange(v: string): void }) {
  return <input className="input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" />;
}

/** Takes payment for everything (or part of what) the customer owes, oldest first. */
function PayAccountModal({ customer, onClose }: { customer: any; onClose(): void }) {
  const { money, toast } = useApp();
  const qc = useQueryClient();
  const tender = useTender(customer.outstanding, { customer: { id: customer.id, balance: customer.balance }, allowPartial: true });
  const m = useMutation({
    mutationFn: () => post(`/api/customers/${customer.id}/account/pay`, tender.payload),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast('success', `Received ${money(r.paid)}${r.remaining > 0 ? ` · ${money(r.remaining)} still owed` : ' · all paid'}`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Payment from ${customer.fullName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!tender.valid || tender.total <= 0 || m.isPending} onClick={() => m.mutate()}>
            Receive {money(tender.total)}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="total-row">
        <span>Owed</span>
        <span>{money(customer.outstanding)}</span>
      </div>
      <div className="hint">Part payment is fine — the oldest items are paid first.</div>
      {tender.ui}
    </Modal>
  );
}

/** Staff: change saved time to another station type at the same value. */
function ConvertTimeModal({ customer, onClose }: { customer: any; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['station-categories'], queryFn: () => get('/api/station-categories') });
  const from = (customer.savedTime ?? []) as any[];
  const [fromId, setFromId] = useState<string>(from.find((f) => f.categoryId)?.categoryId ?? '');
  const [toId, setToId] = useState('');
  const have = Math.floor((from.find((f) => (f.categoryId ?? '') === fromId)?.seconds ?? 0) / 60);
  const [minutes, setMinutes] = useState('');
  useEffect(() => setMinutes(String(have)), [fromId, have]);
  const n = Math.min(Number(minutes) || 0, have);
  const body = { fromCategoryId: fromId || null, toCategoryId: toId, minutes: n };
  const preview = useQuery({
    queryKey: ['convert-preview', customer.id, fromId, toId, n],
    queryFn: () => post(`/api/customers/${customer.id}/time/convert`, { ...body, preview: true }),
    enabled: !!toId && n > 0,
    retry: false,
  });
  const m = useMutation({
    mutationFn: () => post(`/api/customers/${customer.id}/time/convert`, body),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      toast('success', `${formatMinutes(r.fromMinutes)} ${r.from} → ${formatMinutes(r.toMinutes)} ${r.to}`);
      onClose();
    },
  });
  return (
    <Modal
      title="Change saved time to another station type"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!preview.data || m.isPending} onClick={() => m.mutate()}>
            Change it
          </button>
        </>
      }
    >
      <ErrorBox error={m.error || preview.error} />
      <div className="hint">Changed at the same money value, using each type's cheapest hourly price (Pricing). Example: 5 h of PC at GH₵10/h = GH₵50 = 2 h 30 min of PS5 at GH₵20/h.</div>
      <div className="form-grid">
        <Field label="From">
          <select className="select" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {from.map((f) => (
              <option key={f.categoryId ?? 'any'} value={f.categoryId ?? ''}>
                {f.name} ({formatMinutes(Math.floor(f.seconds / 60))})
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select className="select" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose…</option>
            {(cats.data ?? [])
              .filter((x: any) => x.id !== fromId)
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Minutes to change">
          <input className="input" type="number" min={1} max={have} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </div>
      {preview.data && (
        <div className="total-row">
          <span>
            {formatMinutes(preview.data.fromMinutes)} {preview.data.from} becomes
          </span>
          <span>
            {formatMinutes(preview.data.toMinutes)} {preview.data.to}
          </span>
        </div>
      )}
    </Modal>
  );
}
