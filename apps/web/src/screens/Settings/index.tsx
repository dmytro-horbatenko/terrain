import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type ApiError } from '../../api/client';
import {
  useMe,
  useUpdateProfile,
  useLogout,
  useSettings,
  useUpdateSettings,
  useTelegramLinkToken,
  useTelegramUnlink,
} from '../../api/hooks';
import { Card, Loading, useToast } from '../../components';

const SOURCE_FORMATS = ['article', 'book', 'video', 'course', 'documentation', 'exercise'];

export default function Settings() {
  const me = useMe();
  const update = useUpdateProfile();
  const logout = useLogout();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '',
    headline: '',
    learningStyle: '',
    codeStyle: '',
    noteSystem: '',
  });

  useEffect(() => {
    if (me.data)
      setForm({
        name: me.data.name ?? '',
        headline: me.data.headline ?? '',
        learningStyle: me.data.learningStyle ?? '',
        codeStyle: me.data.codeStyle ?? '',
        noteSystem: me.data.noteSystem ?? '',
      });
  }, [me.data]);

  const settings = useSettings();
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const updateSettings = useUpdateSettings();
  const linkToken = useTelegramLinkToken();
  const unlink = useTelegramUnlink();
  const grants = useQuery({
    queryKey: ['oauth-grants'],
    queryFn: api.getOAuthGrants,
    retry: false,
  });
  const disconnect = useMutation({ mutationFn: api.revokeOAuthGrant });
  const [notif, setNotif] = useState({
    timezone: 'UTC',
    digestHour: '9',
    nudgeHour: '20',
    obsidianVault: '',
  });
  const [sources, setSources] = useState({
    preferredSourceFormats: [] as string[],
    sourceTimeBudgetMinutes: '',
    sourceLanguage: '',
    allowPaidSources: false,
  });

  useEffect(() => {
    if (settings.data)
      setNotif({
        timezone: settings.data.timezone,
        digestHour: settings.data.digestHour === null ? 'off' : String(settings.data.digestHour),
        nudgeHour: settings.data.nudgeHour === null ? 'off' : String(settings.data.nudgeHour),
        obsidianVault: settings.data.obsidianVault ?? '',
      });
  }, [settings.data]);

  useEffect(() => {
    if (settings.data)
      setSources({
        preferredSourceFormats: settings.data.preferredSourceFormats,
        sourceTimeBudgetMinutes:
          settings.data.sourceTimeBudgetMinutes === null
            ? ''
            : String(settings.data.sourceTimeBudgetMinutes),
        sourceLanguage: settings.data.sourceLanguage ?? '',
        allowPaidSources: settings.data.allowPaidSources,
      });
  }, [settings.data]);

  const moveFormat = (format: string, direction: -1 | 1) => {
    const formats = [...sources.preferredSourceFormats];
    const from = formats.indexOf(format);
    const to = from + direction;
    if (to < 0 || to >= formats.length) return;
    [formats[from], formats[to]] = [formats[to], formats[from]];
    setSources({ ...sources, preferredSourceFormats: formats });
  };
  const oauthUnavailable = (grants.error as ApiError | null)?.status === 404;

  if (me.isLoading) return <Loading label="Loading…" />;
  const field = (k: keyof typeof form, label: string) => (
    <label className="col gap-1">
      <span className="field-label">{label}</span>
      <input
        className="input"
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1 className="page-title">Settings</h1>
      <div className="col gap-4">
        <Card title="Profile — this drives your session export's WHO I AM block">
          <div className="col gap-3">
            {field('name', 'Name')}
            {field('headline', 'Role')}
            {field('learningStyle', 'Learning style')}
            {field('codeStyle', 'Code style')}
            {field('noteSystem', 'Note system')}
            <button
              className="btn btn-primary"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(form, {
                  onSuccess: () => toast('Profile saved', 'success'),
                  onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
                })
              }
            >
              {update.isPending ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </Card>
        <Card title="Study timezone & notifications">
          <div className="col gap-3">
            {settings.data?.telegramLinked ? (
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <span>Telegram: Linked ✓</span>
                <button
                  className="btn"
                  disabled={unlink.isPending}
                  onClick={() =>
                    unlink.mutate(undefined, {
                      onSuccess: () => toast('Telegram unlinked', 'success'),
                      onError: (e) =>
                        toast(e instanceof Error ? e.message : 'Unlink failed', 'error'),
                    })
                  }
                >
                  Unlink
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                disabled={linkToken.isPending}
                onClick={() =>
                  linkToken.mutate(undefined, {
                    onSuccess: ({ url }) => window.open(url, '_blank'),
                    onError: (e) =>
                      toast(e instanceof Error ? e.message : 'Bot not configured', 'error'),
                  })
                }
              >
                Connect Telegram
              </button>
            )}
            <label className="col gap-1">
              <span className="field-label">Timezone (IANA, e.g. Europe/Kyiv)</span>
              <input
                className="input"
                value={notif.timezone}
                onChange={(e) => setNotif({ ...notif, timezone: e.target.value })}
              />
            </label>
            <p className="faint">
              Your timezone sets review days, streaks, the calendar and reminder hours. Device
              timezone: {deviceTimezone}.
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => setNotif({ ...notif, timezone: deviceTimezone })}
            >
              Use device timezone
            </button>
            <label className="col gap-1">
              <span className="field-label">Morning digest hour</span>
              <select
                className="input"
                value={notif.digestHour}
                onChange={(e) => setNotif({ ...notif, digestHour: e.target.value })}
              >
                <option value="off">Off</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
                ))}
              </select>
            </label>
            <label className="col gap-1">
              <span className="field-label">Evening streak-nudge hour</span>
              <select
                className="input"
                value={notif.nudgeHour}
                onChange={(e) => setNotif({ ...notif, nudgeHour: e.target.value })}
              >
                <option value="off">Off</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
                ))}
              </select>
            </label>
            <label className="col gap-1">
              <span className="field-label">Obsidian vault (enables obsidian:// links)</span>
              <input
                className="input"
                value={notif.obsidianVault}
                onChange={(e) => setNotif({ ...notif, obsidianVault: e.target.value })}
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={updateSettings.isPending}
              onClick={() =>
                updateSettings.mutate(
                  {
                    timezone: notif.timezone,
                    digestHour: notif.digestHour === 'off' ? null : Number(notif.digestHour),
                    nudgeHour: notif.nudgeHour === 'off' ? null : Number(notif.nudgeHour),
                    obsidianVault: notif.obsidianVault === '' ? null : notif.obsidianVault,
                  },
                  {
                    onSuccess: () => toast('Timezone and notification settings saved', 'success'),
                    onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
                  },
                )
              }
            >
              Save timezone & notifications
            </button>
          </div>
        </Card>
        <Card title="Learning sources">
          <div className="col gap-3">
            <div className="col gap-2">
              <span className="field-label">Preferred formats (in priority order)</span>
              {[
                ...sources.preferredSourceFormats,
                ...SOURCE_FORMATS.filter(
                  (format) => !sources.preferredSourceFormats.includes(format),
                ),
              ].map((format) => {
                const selected = sources.preferredSourceFormats.includes(format);
                const index = sources.preferredSourceFormats.indexOf(format);
                return (
                  <div className="row gap-2" key={format} style={{ alignItems: 'center' }}>
                    <label className="row gap-2" style={{ alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setSources({
                            ...sources,
                            preferredSourceFormats: selected
                              ? sources.preferredSourceFormats.filter((value) => value !== format)
                              : [...sources.preferredSourceFormats, format],
                          })
                        }
                      />
                      {format}
                    </label>
                    {selected && (
                      <>
                        <button
                          type="button"
                          className="btn"
                          disabled={index === 0}
                          onClick={() => moveFormat(format, -1)}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={index === sources.preferredSourceFormats.length - 1}
                          onClick={() => moveFormat(format, 1)}
                        >
                          Down
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <label className="col gap-1">
              <span className="field-label">Time budget (minutes)</span>
              <input
                className="input"
                type="number"
                min={5}
                max={600}
                value={sources.sourceTimeBudgetMinutes}
                onChange={(e) =>
                  setSources({ ...sources, sourceTimeBudgetMinutes: e.target.value })
                }
              />
            </label>
            <label className="col gap-1">
              <span className="field-label">Language</span>
              <input
                className="input"
                maxLength={50}
                value={sources.sourceLanguage}
                onChange={(e) => setSources({ ...sources, sourceLanguage: e.target.value })}
              />
            </label>
            <label className="row gap-2" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={sources.allowPaidSources}
                onChange={(e) => setSources({ ...sources, allowPaidSources: e.target.checked })}
              />
              Allow paid sources
            </label>
            <button
              className="btn btn-primary"
              disabled={updateSettings.isPending}
              onClick={() =>
                updateSettings.mutate(
                  {
                    preferredSourceFormats: sources.preferredSourceFormats,
                    sourceTimeBudgetMinutes:
                      sources.sourceTimeBudgetMinutes === ''
                        ? null
                        : Number(sources.sourceTimeBudgetMinutes),
                    sourceLanguage: sources.sourceLanguage === '' ? null : sources.sourceLanguage,
                    allowPaidSources: sources.allowPaidSources,
                  },
                  {
                    onSuccess: () => toast('Learning source settings saved', 'success'),
                    onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
                  },
                )
              }
            >
              Save learning sources
            </button>
          </div>
        </Card>
        {!oauthUnavailable && (
          <Card title="Connected AI clients">
            {grants.isLoading ? (
              <span className="muted">Loading connections…</span>
            ) : grants.isError ? (
              <div className="errorbox">Could not load connected clients.</div>
            ) : grants.data?.length ? (
              <div className="col gap-3">
                {grants.data.map((grant) => (
                  <div className="row gap-3" key={grant.clientId}>
                    <div className="col gap-1 grow">
                      <b>{grant.clientName}</b>
                      <span className="muted mono">{grant.clientId}</span>
                      <span className="muted">
                        {grant.scopes.join(', ')} · connected{' '}
                        {new Date(grant.connectedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      className="btn btn-danger"
                      disabled={disconnect.isPending}
                      onClick={() =>
                        disconnect.mutate(grant.clientId, {
                          onSuccess: () => {
                            void grants.refetch();
                            toast(`${grant.clientName} disconnected`, 'success');
                          },
                          onError: (error) =>
                            toast(
                              error instanceof Error ? error.message : 'Disconnect failed',
                              'error',
                            ),
                        })
                      }
                    >
                      {disconnect.isPending && disconnect.variables === grant.clientId
                        ? 'Disconnecting…'
                        : 'Disconnect'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <span className="muted">No AI clients connected.</span>
            )}
          </Card>
        )}
        <Card title="Account">
          <button className="btn" onClick={() => logout.mutate()}>
            Log out
          </button>
        </Card>
      </div>
    </div>
  );
}
