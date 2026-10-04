import { type FormEvent, useEffect, useId, useState } from 'react';
import { defaultAuthority } from '@/lib/auth/config';
import { sendRequest } from '@/lib/messages';
import {
  authorityItem,
  CACHE_TTL_HOURS,
  cacheTtlHoursItem,
  clampSetting,
  normaliseAuthority,
  SPIKE_THRESHOLD,
  spikeThresholdPctItem,
} from '@/lib/settings';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export interface OptionsProps {
  /** Injectable for tests; defaults to messaging the background worker. */
  request?: typeof sendRequest;
}

export function Options({ request = sendRequest }: OptionsProps) {
  return (
    <main>
      <h1>azinfo options</h1>
      <SignInSection request={request} />
      <NumberSetting
        title="Cost data"
        label="Reuse cost data for"
        unit="hours"
        help="Azure updates cost data every few hours. Shorter means more queries, which Azure rate-limits."
        bounds={CACHE_TTL_HOURS}
        item={cacheTtlHoursItem}
      />
      <ClearCacheSection request={request} />
      <NumberSetting
        title="Spike flag"
        label="Flag when projected month-end is more than"
        unit="% above last month"
        help="Checked from the 6th of the month, once 5 full days of data exist. Never flagged when last month had no cost."
        bounds={SPIKE_THRESHOLD}
        item={spikeThresholdPctItem}
      />
    </main>
  );
}

function SignInSection({ request }: { request: typeof sendRequest }) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void authorityItem.getValue().then((stored) => {
      setSaved(stored);
      setValue(stored ?? defaultAuthority());
    });
  }, []);

  async function apply(authority: string | null) {
    const res = await request({ type: 'setAuthority', authority });
    if (!res.ok) {
      setNotice({ kind: 'error', text: res.message });
      return;
    }
    setSaved(authority === null ? null : res.data.authority);
    setValue(res.data.authority);
    setNotice({
      kind: 'ok',
      text: `Saved: ${res.data.authority}. You have been signed out; sign in again from the toolbar button.`,
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const authority = normaliseAuthority(value);
    if (!authority) {
      setNotice({
        kind: 'error',
        text: 'Enter organizations, common, a tenant domain (contoso.onmicrosoft.com) or a tenant ID.',
      });
      return;
    }
    await apply(authority);
  }

  return (
    <section>
      <h2>Sign-in</h2>
      <form onSubmit={submit} noValidate>
        <label htmlFor={inputId}>Microsoft Entra tenant</label>
        <div className="row">
          <input
            id={inputId}
            type="text"
            value={value}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit">Save</button>
          {saved !== null && (
            <button type="button" onClick={() => apply(null)}>
              Reset to default
            </button>
          )}
        </div>
      </form>
      <p className="help">
        Work or school accounts: <code>organizations</code>. Personal Microsoft accounts (Outlook,
        Gmail and so on): your tenant, for example <code>yourname.onmicrosoft.com</code>, shown
        under your name in the Azure portal's account menu. Changing this signs you out.
      </p>
      <NoticeLine notice={notice} />
    </section>
  );
}

function NumberSetting({
  title,
  label,
  unit,
  help,
  bounds,
  item,
}: {
  title: string;
  label: string;
  unit: string;
  help: string;
  bounds: { default: number; min: number; max: number };
  item: typeof cacheTtlHoursItem;
}) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void item.getValue().then((v) => setValue(String(clampSetting(v, bounds))));
  }, [item, bounds]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < bounds.min || n > bounds.max) {
      setNotice({ kind: 'error', text: `Enter a number from ${bounds.min} to ${bounds.max}.` });
      return;
    }
    await item.setValue(n);
    setNotice({ kind: 'ok', text: 'Saved.' });
  }

  return (
    <section>
      <h2>{title}</h2>
      <form onSubmit={submit} noValidate>
        <label htmlFor={inputId}>{label}</label>
        <div className="row">
          <input
            id={inputId}
            className="number"
            type="number"
            inputMode="decimal"
            min={bounds.min}
            max={bounds.max}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span>{unit}</span>
          <button type="submit">Save</button>
        </div>
      </form>
      <p className="help">
        {help} Default: {bounds.default}.
      </p>
      <NoticeLine notice={notice} />
    </section>
  );
}

function ClearCacheSection({ request }: { request: typeof sendRequest }) {
  const [notice, setNotice] = useState<Notice>(null);

  async function clear() {
    const res = await request({ type: 'clearCache' });
    setNotice(
      res.ok
        ? { kind: 'ok', text: 'Cached cost data cleared. The next view queries Azure again.' }
        : { kind: 'error', text: res.message },
    );
  }

  return (
    <section>
      <h2>Cached data</h2>
      <p className="help">
        Removes cost data stored on this device. Your sign-in and these settings stay.
      </p>
      <button type="button" onClick={clear}>
        Clear cached data
      </button>
      <NoticeLine notice={notice} />
    </section>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p className={notice.kind === 'ok' ? 'ok' : 'error'} role="status">
      {notice.text}
    </p>
  );
}
