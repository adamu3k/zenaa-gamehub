import { Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ErrorBox, Field, PasswordInput } from '../components/ui';
import { useApp } from '../lib/app-context';
import { ThemeToggle } from '../lib/theme';

export function LoginPage() {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">
            <Zap size={18} />
          </div>
          <div>
            ZENAA GAMEHUB
            <small>Gaming centre management</small>
          </div>
        </div>
        <h1>Staff sign in</h1>
        <ErrorBox error={error} />
        <Field label="Username">
          <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password">
          <PasswordInput className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="toolbar" style={{ fontSize: 13 }}>
          <a href="/portal" className="muted">
            Customer? Open the customer portal →
          </a>
          <div className="spacer" />
          <ThemeToggle />
        </div>
      </form>
    </div>
  );
}
