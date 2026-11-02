'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/authFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useIsSuperAdmin } from '@/lib/hooks/useIsSuperAdmin';
import {
  VOICE_FALLBACKS,
  VOICE_PROVIDERS,
  VOICE_FUNCTIONS,
  type VoiceFallbackId,
  type VoiceFunction,
  type VoiceProviderId,
} from '@/lib/hai/voice/settings';

// HAI admin page (platform admin only): which provider listens and speaks in the
// voice assistant, the fallback, and the state of every provider. The routes
// behind it (GET and PUT /api/admin/hai/settings, GET /api/admin/hai/voice-status)
// check the role themselves, hiding the page here is not the protection.

type Status = 'ready' | 'not_configured' | 'disturbed';

type ProviderInfo = {
  id: VoiceProviderId;
  /** The summary: disturbed as soon as one function is. */
  status: Status;
  reason: string | null;
  /** The state of listening (stt) and speaking (tts); missing in an older answer. */
  functions?: Record<VoiceFunction, { status: Status; reason: string | null }>;
  keySet?: boolean;
  region?: 'eu' | 'us' | null;
  reachable?: boolean | null;
  sttOffered?: boolean | null;
  ttsOffered?: boolean | null;
};

type VoiceStatus = {
  providers: Record<VoiceProviderId, ProviderInfo>;
  effective: {
    provider: VoiceProviderId;
    chain: VoiceProviderId[];
    chains?: Record<VoiceFunction, VoiceProviderId[]>;
  };
};

const STATUS_STYLE: Record<Status, string> = {
  ready: 'bg-green-500/10 text-green-500',
  not_configured: 'bg-yellow-500/10 text-yellow-500',
  disturbed: 'bg-red-500/10 text-red-500',
};

export default function AdminHaiPage() {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();
  const isSuperAdmin = useIsSuperAdmin();

  const [primary, setPrimary] = useState<VoiceProviderId>('soniox');
  const [fallback, setFallback] = useState<VoiceFallbackId>('browser');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/hai/settings', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('settings');
      const data = await res.json();
      setPrimary(data.settings.primary);
      setFallback(data.settings.fallback);
      setLoadError(null);
    } catch {
      setLoadError(t('admin.hai.loadFailed'));
    }
  }, [t]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await authFetch('/api/admin/hai/voice-status', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('status');
      setStatus(await res.json());
      setStatusError(null);
    } catch {
      setStatusError(t('admin.hai.statusFailed'));
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!profile || !isSuperAdmin) return;
    void loadSettings();
    void loadStatus();
  }, [profile, isSuperAdmin, loadSettings, loadStatus]);

  const providerName = (id: VoiceProviderId) => t(`admin.hai.provider.${id}`);
  const reasonText = (reason: string | null) => {
    if (!reason) return '';
    const key = `admin.hai.reason.${reason}`;
    const text = t(key);
    return text === key ? t('admin.hai.reason.unknown') : text;
  };
  const yesNo = (value: boolean | null | undefined) =>
    value === null || value === undefined
      ? t('admin.hai.detail.unknown')
      : value
        ? t('admin.hai.detail.yes')
        : t('admin.hai.detail.no');

  // the functions of a provider that are disturbed right now (empty when it is
  // not set up, then the one reason holds for the whole provider)
  const disturbedFunctions = (info: ProviderInfo): VoiceFunction[] =>
    info.status === 'disturbed' && info.functions
      ? VOICE_FUNCTIONS.filter(fn => info.functions![fn].status === 'disturbed')
      : [];

  // listening and speaking walk different chains while a provider is disturbed in
  // one function only
  const chainsDiffer =
    !!status?.effective.chains &&
    status.effective.chains.stt.join() !== status.effective.chains.tts.join();

  const sameChoice = primary === fallback;

  const save = async () => {
    if (sameChoice) {
      toast.error(t('admin.hai.sameProvider'));
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch('/api/admin/hai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary, fallback }),
      });
      if (!res.ok) throw new Error('save');
      toast.success(t('admin.hai.saved'));
      void loadStatus();
    } catch {
      toast.error(t('admin.hai.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!profile || !isSuperAdmin) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <p className="text-muted-foreground">{t('common.accessDenied')}</p>
      </div>
    );
  }

  const region = status?.providers.soniox.region ?? 'eu';
  const regionLabel = t(
    region === 'us' ? 'hai.voice.region.us' : 'hai.voice.region.eu'
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br">
            <Mic className="text-foreground h-8 w-8" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('admin.hai.title')}
            </h1>
            <p className="text-muted">{t('admin.hai.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Choice of provider */}
      <section className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <h2 className="text-foreground mb-2 text-xl font-bold">
          {t('admin.hai.choice.title')}
        </h2>
        <p className="text-muted mb-6 text-sm">{t('admin.hai.choice.hint')}</p>
        {loadError && (
          <p role="alert" className="mb-4 text-sm text-red-500">
            {loadError}
          </p>
        )}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <label
              htmlFor="hai-voice-primary"
              className="text-foreground mb-1.5 block text-sm font-medium"
            >
              {t('admin.hai.choice.primary')}
            </label>
            <select
              id="hai-voice-primary"
              value={primary}
              onChange={e => setPrimary(e.target.value as VoiceProviderId)}
              className="bg-background border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-3 focus:ring-2 focus:outline-none"
            >
              {VOICE_PROVIDERS.map(id => (
                <option key={id} value={id}>
                  {providerName(id)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="hai-voice-fallback"
              className="text-foreground mb-1.5 block text-sm font-medium"
            >
              {t('admin.hai.choice.fallback')}
            </label>
            <select
              id="hai-voice-fallback"
              value={fallback}
              onChange={e => setFallback(e.target.value as VoiceFallbackId)}
              className="bg-background border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-3 focus:ring-2 focus:outline-none"
            >
              {VOICE_FALLBACKS.map(id => (
                <option key={id} value={id}>
                  {providerName(id)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {sameChoice && (
          <p role="alert" className="mt-3 text-sm text-yellow-500">
            {t('admin.hai.sameProvider')}
          </p>
        )}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving || sameChoice || !!loadError}
            className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-2.5 font-medium transition-colors disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('admin.hai.choice.save')}
          </button>
        </div>
      </section>

      {/* State of the providers */}
      <section className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-foreground text-xl font-bold">
            {t('admin.hai.status.title')}
          </h2>
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={statusLoading}
            className="text-muted hover:text-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${statusLoading ? 'animate-spin' : ''}`}
            />
            {t('admin.hai.status.refresh')}
          </button>
        </div>
        {statusError && (
          <p role="alert" className="mb-4 text-sm text-red-500">
            {statusError}
          </p>
        )}
        {status && (
          <>
            {chainsDiffer ? (
              <div className="text-muted mb-4 space-y-1 text-sm">
                {VOICE_FUNCTIONS.map(fn => (
                  <p key={fn} data-testid={`hai-chain-${fn}`}>
                    {t(`admin.hai.status.effective.${fn}`, {
                      chain: status
                        .effective!.chains![fn].map(providerName)
                        .join(', '),
                    })}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-muted mb-4 text-sm">
                {t('admin.hai.status.effective', {
                  chain: status.effective.chain.map(providerName).join(', '),
                })}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {VOICE_PROVIDERS.map(id => {
                const info = status.providers[id];
                return (
                  <div
                    key={id}
                    className="border-border rounded-2xl border p-4"
                    data-testid={`hai-provider-${id}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-foreground font-semibold">
                        {providerName(id)}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[info.status]}`}
                      >
                        {t(`admin.hai.status.${info.status}`)}
                      </span>
                    </div>
                    {disturbedFunctions(info).length > 0 ? (
                      // a failure is per function: say which one is out
                      <ul className="text-muted mb-2 space-y-1 text-sm">
                        {disturbedFunctions(info).map(fn => (
                          <li
                            key={fn}
                            data-testid={`hai-disturbed-${id}-${fn}`}
                          >
                            {t(`admin.hai.status.function.${fn}`)}:{' '}
                            {reasonText(info.functions![fn].reason)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      info.reason && (
                        <p className="text-muted mb-2 text-sm">
                          {reasonText(info.reason)}
                        </p>
                      )
                    )}
                    <dl className="text-muted space-y-1 text-xs">
                      {info.keySet !== undefined && (
                        <div className="flex justify-between gap-2">
                          <dt>{t('admin.hai.detail.keySet')}</dt>
                          <dd>{yesNo(info.keySet)}</dd>
                        </div>
                      )}
                      {id === 'soniox' && info.region && (
                        <div className="flex justify-between gap-2">
                          <dt>{t('admin.hai.detail.region')}</dt>
                          <dd>{info.region.toUpperCase()}</dd>
                        </div>
                      )}
                      {id === 'haus' && (
                        <>
                          <div className="flex justify-between gap-2">
                            <dt>{t('admin.hai.detail.reachable')}</dt>
                            <dd>{yesNo(info.reachable)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t('admin.hai.detail.sttOffered')}</dt>
                            <dd>{yesNo(info.sttOffered)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t('admin.hai.detail.ttsOffered')}</dt>
                            <dd>{yesNo(info.ttsOffered)}</dd>
                          </div>
                        </>
                      )}
                    </dl>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Data protection per provider */}
      <section className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          <ShieldCheck className="text-accent h-6 w-6" />
          <h2 className="text-foreground text-xl font-bold">
            {t('admin.hai.privacy.title')}
          </h2>
        </div>
        <dl className="space-y-4 text-sm">
          {VOICE_PROVIDERS.map(id => (
            <div key={id}>
              <dt className="text-foreground font-semibold">
                {providerName(id)}
              </dt>
              <dd className="text-muted">
                {t(`admin.hai.privacy.${id}`, { region: regionLabel })}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* The switch per organization stays decisive */}
      <section className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <h2 className="text-foreground mb-2 text-xl font-bold">
          {t('admin.hai.org.title')}
        </h2>
        <p className="text-muted text-sm">{t('admin.hai.org.text')}</p>
      </section>
    </div>
  );
}
