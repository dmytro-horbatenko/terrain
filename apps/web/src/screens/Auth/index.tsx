import { useState, type FormEvent } from 'react';
import { useLogin, useRegister } from '../../api/hooks';
import { Card, useToast } from '../../components';

/** Login / register screen shown by <AuthGate> when there is no session. */
export default function AuthScreen() {
  const { toast } = useToast();
  const login = useLogin();
  const register = useRegister();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const pending = login.isPending || register.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const onError = (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Auth failed', 'error');
    if (mode === 'login') login.mutate({ email, password }, { onError });
    else register.mutate({ email, password, name }, { onError });
  };

  return (
    <div className="page" style={{ maxWidth: 420, margin: '10vh auto' }}>
      <h1 className="page-title">Terrain</h1>
      <Card title={mode === 'login' ? 'Log in' : 'Create account'}>
        <form className="col gap-3" onSubmit={submit}>
          {mode === 'register' && (
            <input
              className="input"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <button className="btn btn-primary" disabled={pending} type="submit">
            {pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
          </button>
        </form>
      </Card>
    </div>
  );
}
