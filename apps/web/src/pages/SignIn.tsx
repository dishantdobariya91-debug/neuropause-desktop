import { useEffect, useState } from 'react';
import { auth, type ProviderInfo } from '../lib/api';

export default function SignIn() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    auth
      .providers()
      .then((p) => setProviders(Array.isArray(p) ? p : (p.providers ?? [])))
      .catch((e: Error) => setError(`Backend unreachable: ${e.message}`));
  }, []);

  return (
    <main>
      <h1>Sign in / Register</h1>
      <p>Signing in with a provider creates your NeuroPause account on first use.</p>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
        {providers.map((p) => (
          <a key={p.id} href={auth.startUrl(p.id)} style={{ padding: 8, border: '1px solid #ccc', borderRadius: 6, textAlign: 'center' }}>
            Continue with {p.name ?? p.id}
          </a>
        ))}
        {providers.length === 0 && !error && <p>Loading providers…</p>}
      </div>
      <h2 style={{ marginTop: 32 }}>Forgot password</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          auth
            .requestPasswordReset(email)
            .then(() => setResetMsg('If that email exists, a reset link has been sent.'))
            .catch((err: Error) => setResetMsg(`Request failed: ${err.message}`));
        }}
      >
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" required />
        <button type="submit" style={{ marginLeft: 8 }}>Send reset link</button>
      </form>
      {resetMsg && <p>{resetMsg}</p>}
    </main>
  );
}
