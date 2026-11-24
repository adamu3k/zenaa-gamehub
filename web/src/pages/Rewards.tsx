import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Gift, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MoneyInput } from '../components/money';
import { DeleteButton } from '../components/DeleteButton';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, parseMoney, toMajorString } from '../lib/format';
import { SOCIALS } from '../portal/PortalExtras';

const toLocalInput = (d: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const platformLabel = (k?: string | null) => SOCIALS.find((s) => s.key === k);

/** Follow-us bonuses, bonus codes and the claims staff check. */
export function RewardsPage() {
  const { settings } = useApp();
  return (
    <>
      <PageHeader
        title="Rewards"
        subtitle={
          <>
            Give customers wallet credit for following your pages (YouTube, TikTok, Instagram…) or for typing a bonus code you share. Each reward is paid once per
            customer. Promo codes marked <i>Show in the app</i> (<Link to="/promotions">Promotions</Link>) are listed on the same customer page.
            {!settings.rewardsEnabled && (
              <b>
                {' '}
                The Rewards page is switched off — <Link to="/settings#chat">Settings → Customer chat & rewards</Link>.
              </b>
            )}
          </>
        }
      />
      <Claims />
      <Offers />
    </>
  );
}

function Claims() {
  const { money, toast } = useApp();
  const qc = useQueryClient();
  const [all, setAll] = useState<'pending' | 'all'>('pending');
  const q = useQuery({ queryKey: ['rewards', 'claims', all], queryFn: () => get<any[]>(`/api/rewards/claims?status=${all}`), refetchInterval: 30_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['rewards'] });
  const approve = useMutation({ mutationFn: (id: string) => post(`/api/rewards/claims/${id}/approve`), onSuccess: () => (toast('success', 'Bonus paid into their wallet'), refresh()) });
  const reject = useMutation({
    mutationFn: (v: { id: string; note: string }) => post(`/api/rewards/claims/${v.id}/reject`, { note: v.note || null }),
    onSuccess: () => (toast('success', 'Claim turned down'), refresh()),
  });
  const list = q.data ?? [];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Claims to check</h2>
          <div className="dim" style={{ fontSize: 12 }}>
            Open the page, look for the customer's username among your followers/subscribers, then press Pay. The app cannot see who followed by itself.
          </div>
        </div>
        <Segmented
          value={all}
          onChange={setAll}
          options={[
            { value: 'pending', label: 'Waiting' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      <ErrorBox error={q.error || approve.error || reject.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Reward</th>
              <th>Their username</th>
              <th>When</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {all === 'pending' ? 'Nothing waiting' : 'No claims yet'}
                </td>
              </tr>
            )}
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.customer.name}</strong>
                  <div className="dim mono" style={{ fontSize: 12 }}>
                    ZG-{String(c.customer.number).padStart(6, '0')}
                    {c.customer.gamertag ? ` · ${c.customer.gamertag}` : ''}
                  </div>
                </td>
                <td>
                  {platformLabel(c.offer.platform)?.emoji} {c.offer.title}
                  {c.offer.url && (
                    <a href={c.offer.url} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }} title="Open the page">
                      <ExternalLink size={12} />
                    </a>
                  )}
                </td>
                <td className="mono">{c.handle ?? (c.offer.kind === 'code' ? 'bonus code' : '—')}</td>
                <td className="dim">{formatDateTime(c.createdAt)}</td>
                <td>
                  {c.status === 'pending' ? (
                    <span className="badge badge-warning">waiting</span>
                  ) : c.status === 'approved' ? (
                    <span className="badge badge-success">paid {money(c.amount)}</span>
                  ) : (
                    <span className="badge" title={c.note ?? ''}>
                      turned down
                    </span>
                  )}
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  {c.status === 'pending' && (
                    <>
                      <button className="btn btn-primary btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>
                        <Check size={14} /> Pay
                      </button>{' '}
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={reject.isPending}
                        onClick={() => reject.mutate({ id: c.id, note: window.prompt('Reason shown to the customer (optional)', 'We could not find you among our followers') ?? '' })}
                      >
                        <X size={14} /> No
                      </button>
                    </>
                  )}{' '}
                  <DeleteButton
                    icon
                    url={`/api/rewards/claims/${c.id}`}
                    what="this claim"
                    confirmText={c.status === 'approved' ? 'Delete this claim from the list? The bonus already paid stays in their wallet history.' : 'Delete this claim?'}
                    refresh={[['rewards']]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Offers() {
  const { money } = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rewards', 'list'], queryFn: () => get<any>('/api/rewards') });
  const [editing, setEditing] = useState<any | 'follow' | 'code' | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/rewards/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['rewards'] }) });
  const offers = (q.data?.offers ?? []) as any[];
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <Gift size={18} style={{ verticalAlign: -3 }} /> Rewards customers can get
        </h2>
        <div className="toolbar">
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('follow')}>
            <Plus size={14} /> Follow-us bonus
          </button>
          <button className="btn btn-sm" onClick={() => setEditing('code')}>
            <Plus size={14} /> Bonus code
          </button>
        </div>
      </div>
      <ErrorBox error={q.error || remove.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reward</th>
              <th>Customer gets</th>
              <th className="right">Claimed</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No rewards yet. Start with "Subscribe to our YouTube — get {money(500)}".
                </td>
              </tr>
            )}
            {offers.map((o) => {
              const ended = (o.validTo && new Date(o.validTo) < new Date()) || (o.maxClaims != null && o.claimsCount >= o.maxClaims);
              return (
                <tr key={o.id} style={{ opacity: o.active && !ended ? 1 : 0.55 }}>
                  <td>
                    <strong>
                      {o.kind === 'follow' ? platformLabel(o.platform)?.emoji ?? '⭐' : '🎟️'} {o.title}
                    </strong>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {o.kind === 'code' ? (
                        <>
                          Code <span className="mono">{o.code}</span>
                        </>
                      ) : (
                        <>
                          {o.needsApproval ? 'Staff check first' : 'Paid at once (honour system)'} ·{' '}
                          <a href={o.url} target="_blank" rel="noreferrer">
                            link
                          </a>
                        </>
                      )}
                      {o.validTo && ` · until ${formatDateTime(o.validTo)}`}
                    </div>
                  </td>
                  <td>
                    {o.bonusAmount > 0 && money(o.bonusAmount)}
                    {o.bonusAmount > 0 && o.promoCode && ' + '}
                    {o.promoCode && <span className="mono">{o.promoCode}</span>}
                  </td>
                  <td className="right num">
                    {o.claimsCount}
                    {o.maxClaims != null ? ` / ${o.maxClaims}` : ''}
                  </td>
                  <td>{!o.active ? <span className="badge">Off</span> : ended ? <span className="badge badge-warning">Ended</span> : <span className="badge badge-success">On</span>}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(o)} aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label="Delete"
                      onClick={() => window.confirm(`Remove "${o.title}"? Rewards already paid stay in the history.`) && remove.mutate(o.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && <OfferForm offer={typeof editing === 'string' ? null : editing} kind={typeof editing === 'string' ? editing : editing.kind} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OfferForm({ offer, kind, onClose }: { offer: any | null; kind: 'follow' | 'code'; onClose(): void }) {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const mu = settings.currencyMinorUnits;
  const firstSocial = SOCIALS.find((s) => settings.socialLinks?.[s.key as keyof typeof settings.socialLinks]);
  const [f, setF] = useState({
    title: offer?.title ?? (kind === 'follow' ? (firstSocial ? `Subscribe to our ${firstSocial.label}` : 'Follow us') : 'Bonus code'),
    description: offer?.description ?? '',
    platform: offer?.platform ?? firstSocial?.key ?? 'youtube',
    url: offer?.url ?? (firstSocial ? settings.socialLinks[firstSocial.key as keyof typeof settings.socialLinks] : ''),
    code: offer?.code ?? '',
    bonus: offer ? toMajorString(offer.bonusAmount, mu) : '5',
    promoCode: offer?.promoCode ?? '',
    needsApproval: offer?.needsApproval ?? true,
    maxClaims: offer?.maxClaims ?? '',
    validTo: toLocalInput(offer?.validTo ?? null),
    active: offer?.active ?? true,
  });
  const pickPlatform = (k: string) => {
    const s = SOCIALS.find((x) => x.key === k);
    const link = settings.socialLinks?.[k as keyof typeof settings.socialLinks] ?? '';
    setF({ ...f, platform: k, url: link || f.url, title: offer ? f.title : `${k === 'youtube' ? 'Subscribe to' : 'Follow'} our ${s?.label ?? k}` });
  };
  const m = useMutation({
    mutationFn: () => {
      const bonusAmount = f.bonus.trim() ? parseMoney(f.bonus, mu) : 0;
      if (bonusAmount == null || bonusAmount < 0) throw new Error('The bonus is not a valid amount');
      const body: any = {
        kind,
        title: f.title,
        description: f.description || null,
        platform: kind === 'follow' ? f.platform : null,
        url: kind === 'follow' ? f.url : null,
        code: kind === 'code' ? f.code : null,
        bonusAmount,
        promoCode: f.promoCode.trim().toUpperCase() || null,
        needsApproval: f.needsApproval,
        maxClaims: f.maxClaims === '' ? null : Number(f.maxClaims),
        validTo: f.validTo ? new Date(f.validTo).toISOString() : null,
        active: f.active,
      };
      return offer ? patch(`/api/rewards/${offer.id}`, body) : post('/api/rewards', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rewards'] });
      toast('success', offer ? 'Reward updated' : 'Reward added — customers see it in the app under Rewards');
      onClose();
    },
  });
  return (
    <Modal
      title={offer ? `Edit ${offer.title}` : kind === 'follow' ? 'Follow-us bonus' : 'Bonus code'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="form-grid">
        {kind === 'follow' && (
          <>
            <Field label="Where">
              <select className="select" value={f.platform} onChange={(e) => pickPlatform(e.target.value)}>
                {SOCIALS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.emoji} {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Link to your page" hint="Filled from Settings → Socials when set">
              <input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://youtube.com/@yourname" />
            </Field>
          </>
        )}
        {kind === 'code' && (
          <Field label="The code customers type" hint="Share it on a poster, a live stream or your WhatsApp status">
            <input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="LIVE500" />
          </Field>
        )}
        <Field label="Title customers see">
          <input className="input" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={`Bonus into their wallet (${settings.currencyCode})`} hint="0 = no money, only the promo code">
          <MoneyInput value={f.bonus} onChange={(v) => setF({ ...f, bonus: v })} />
        </Field>
        <Field label="Also give a promo code (optional)" hint="Shown after the reward is given, e.g. a discount code from Promotions">
          <input className="input mono" value={f.promoCode} onChange={(e) => setF({ ...f, promoCode: e.target.value.toUpperCase() })} placeholder="SUBSCRIBER10" />
        </Field>
        <Field label="Short note (optional)" full>
          <input className="input" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Turn on notifications 🔔 to hear about tournaments first" />
        </Field>
        <Field label="Most customers who can get it" hint="Blank = no limit">
          <input className="input" type="number" min={1} value={f.maxClaims} onChange={(e) => setF({ ...f, maxClaims: e.target.value === '' ? '' : Number(e.target.value) })} />
        </Field>
        <Field label="Ends (optional)">
          <input className="input" type="datetime-local" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
        </Field>
        {kind === 'follow' && (
          <label className="check" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={f.needsApproval} onChange={(e) => setF({ ...f, needsApproval: e.target.checked })} /> Staff check the customer's username before
            paying (recommended — otherwise anyone can press "I followed")
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> On
        </label>
      </div>
    </Modal>
  );
}
