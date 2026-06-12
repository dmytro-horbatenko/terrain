import { useEffect, useState } from 'react';
import { useMe, useUpdateProfile, useLogout } from '../../api/hooks';
import { Card, Loading, useToast } from '../../components';

export default function Settings() {
  const me = useMe();
  const update = useUpdateProfile();
  const logout = useLogout();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '',
    role: '',
    learningStyle: '',
    codeStyle: '',
    noteSystem: '',
  });

  useEffect(() => {
    if (me.data)
      setForm({
        name: me.data.name ?? '',
        role: me.data.role ?? '',
        learningStyle: me.data.learningStyle ?? '',
        codeStyle: me.data.codeStyle ?? '',
        noteSystem: me.data.noteSystem ?? '',
      });
  }, [me.data]);

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
      <Card title="Profile — this drives your session export's WHO I AM block">
        <div className="col gap-3">
          {field('name', 'Name')}
          {field('role', 'Role')}
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
      <Card title="Account">
        <button className="btn" onClick={() => logout.mutate()}>
          Log out
        </button>
      </Card>
    </div>
  );
}
