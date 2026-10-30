// The sign-in screen: a single frosted card over the wallpaper. On a fresh install it asks for the setup code from the
// server log and creates the first account instead.
import { ArrowRight, Loader2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Me = { mode: string; user: { name: string } | null; setup?: boolean };

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(setMe).catch(() => setMe({ mode: 'local', user: null })); }, []);
  return { me, setMe };
}

export function signOut(everywhere = false) {
  return fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ everywhere }) })
    .then(() => location.reload());
}

const Field = ({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="block">
    <span className="mb-1.5 block text-[12px] text-muted-foreground">{label}</span>
    <input {...p} className="h-11 w-full rounded-xl border border-white/10 bg-white/[.06] px-3.5 text-[15px] outline-none transition-[border-color,background-color] duration-200 placeholder:text-muted-foreground/60 focus:border-white/30 focus:bg-white/[.09]" />
  </label>
);

export function SignIn({ setup, wallpaper, onDone }: { setup: boolean; wallpaper?: ReactNode; onDone: (name: string) => void }) {
  const [name, setName] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [remember, setRemember] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const r = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setup ? { code, name, password } : { name, password, remember }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setBusy(false);
    if (r?.ok) onDone(j.user.name); else setError(j?.error ?? 'Couldn\'t reach Atrium.');
  };
  return (
    <div className="dark grid min-h-dvh place-items-center px-4 text-foreground">
      {wallpaper}
      <form onSubmit={submit} className="settle glass w-full max-w-[360px] rounded-[28px] border p-7">
        <div className="mb-6">
          <div className="text-[22px] font-semibold tracking-tight">{setup ? 'Welcome' : 'Sign in'}</div>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{setup ? 'Create the first account. The setup code is in the server log.' : 'Your homelab is waiting.'}</p>
        </div>
        <div className="space-y-3.5">
          {setup && <Field label="Setup code" value={code} onChange={e => setCode(e.target.value)} placeholder="xxxx-xxxx-xxxx" autoFocus autoComplete="one-time-code" />}
          <Field label="Name" value={name} onChange={e => setName(e.target.value)} autoFocus={!setup} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          <Field label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} />
        </div>
        {!setup && (
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground select-none">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="size-3.5 accent-[var(--primary)]" />Keep me signed in
          </label>
        )}
        <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out', error ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
          <p className="overflow-hidden text-[13px] text-bad" role="alert">{error}</p>
        </div>
        <button disabled={busy || !name || !password || (setup && !code)}
          className="press mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-medium text-black transition-opacity disabled:opacity-40">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <>{setup ? 'Create account' : 'Sign in'}<ArrowRight className="size-4" /></>}
        </button>
      </form>
    </div>
  );
}
