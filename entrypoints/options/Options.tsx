import { type FormEvent, useEffect, useId, useState } from 'react';
import { defaultAuthority } from '@/lib/auth/config';
import { t } from '@/lib/i18n';
import { T } from '@/lib/i18n-react';
import { sendRequest } from '@/lib/messages';
import {
  authorityItem,
  CACHE_TTL_HOURS,
  COST_TYPES,
  type CostType,
  cacheTtlHoursItem,
  clampSetting,
  costTypeItem,
  normaliseAuthority,
  readCostType,
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
      <h1>{t('optTitle')}</h1>
      <SignInSection request={request} />
      <NumberSetting
        title={t('optCostTitle')}
        label={t('optReuseFor')}
        unit={t('optHours')}
        help={t('optCacheHelp')}
        bounds={CACHE_TTL_HOURS}
        item={cacheTtlHoursItem}
      />
      <CostTypeSection />
      <ClearCacheSection request={request} />
      <NumberSetting
        title={t('optSpikeTitle')}
        label={t('optSpikeLabel')}
        unit={t('optSpikeUnit')}
        help={t('optSpikeHelp')}
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
      text: t('optSavedSignedOut', res.data.authority),
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const authority = normaliseAuthority(value);
    if (!authority) {
      setNotice({
        kind: 'error',
        text: t('optInvalidTenant'),
      });
      return;
    }
    await apply(authority);
  }

  return (
    <section>
      <h2>{t('optSignInTitle')}</h2>
      <form onSubmit={submit} noValidate>
        <label htmlFor={inputId}>{t('optSignInThrough')}</label>
        <div className="row">
          <input
            id={inputId}
            type="text"
            value={value}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit">{t('save')}</button>
          {saved !== null && (
            <button type="button" onClick={() => apply(null)}>
              {t('optReset')}
            </button>
          )}
        </div>
      </form>
      <p className="help">
        <T
          k="optSignInHelp"
          slots={[
            <code key="org">organizations</code>,
            <code key="example">yourname.onmicrosoft.com</code>,
          ]}
        />
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
      setNotice({ kind: 'error', text: t('optNumberRange', bounds.min, bounds.max) });
      return;
    }
    await item.setValue(n);
    setNotice({ kind: 'ok', text: t('optSaved') });
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
          <button type="submit">{t('save')}</button>
        </div>
      </form>
      <p className="help">
        {help} {t('optDefault', bounds.default)}
      </p>
      <NoticeLine notice={notice} />
    </section>
  );
}

const COST_TYPE_TEXT = {
  ActualCost: { label: 'costTypeActual', help: 'optCostTypeActualHelp' },
  AmortizedCost: { label: 'costTypeAmortized', help: 'optCostTypeAmortizedHelp' },
} as const;

/** Actual or amortized cost (decision 008). Each has its own cache, so switching is instant once fetched. */
function CostTypeSection() {
  const name = useId();
  const [value, setValue] = useState<CostType>('ActualCost');
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void readCostType().then(setValue);
  }, []);

  async function choose(next: CostType) {
    setValue(next);
    await costTypeItem.setValue(next);
    setNotice({ kind: 'ok', text: t('optSaved') });
  }

  return (
    <section>
      <h2>{t('optCostTypeTitle')}</h2>
      <fieldset className="choices-list">
        <legend className="visually-hidden">{t('optCostTypeTitle')}</legend>
        {COST_TYPES.map((type) => (
          <label key={type} className="choice">
            <input
              type="radio"
              name={name}
              value={type}
              checked={value === type}
              onChange={() => choose(type)}
            />
            <span>
              <strong>{t(COST_TYPE_TEXT[type].label)}</strong>
              <span className="help">{t(COST_TYPE_TEXT[type].help)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="help">{t('optCostTypeHelp')}</p>
      <NoticeLine notice={notice} />
    </section>
  );
}

function ClearCacheSection({ request }: { request: typeof sendRequest }) {
  const [notice, setNotice] = useState<Notice>(null);

  async function clear() {
    const res = await request({ type: 'clearCache' });
    setNotice(
      res.ok ? { kind: 'ok', text: t('optCacheCleared') } : { kind: 'error', text: res.message },
    );
  }

  return (
    <section>
      <h2>{t('optCachedTitle')}</h2>
      <p className="help">{t('optCachedHelp')}</p>
      <button type="button" onClick={clear}>
        {t('optClearCache')}
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
