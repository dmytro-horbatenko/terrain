import { useEffect, useState } from 'react';
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
  const updateSettings = useUpdateSettings();
  const linkToken = useTelegramLinkToken();
  const unlink = useTelegramUnlink();
  const [notif, setNotif] = useState({
    timezone: 'UTC',
    digestHour: '9',
    nudgeHour: '20',
    obsidianVault: '',
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
        <Card title="Notifications — Telegram digest & streak nudge">
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
                    onSuccess: () => toast('Notification settings saved', 'success'),
                    onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
                  },
                )
              }
            >
              Save notifications
            </button>
          </div>
        </Card>
        <Card title="Account">
          <button className="btn" onClick={() => logout.mutate()}>
            Log out
          </button>
        </Card>
      </div>
    </div>
  );
}
