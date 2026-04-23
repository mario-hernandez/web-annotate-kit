import { useEffect, useState, type FormEvent } from 'react';
import { clearRl, getLockSeconds, recordFailure, useReview } from './ReviewProvider';

export interface ReviewLoginProps {
  /** Brand name shown in the hero. Default: "Review". */
  brand?: string;
  /** Subtitle. Default: "Access restricted". */
  subtitle?: string;
  /** Accent color for the button. Default: "#305B91". */
  accentColor?: string;
  /**
   * When present, shows a dev-only quick-select panel with the listed passwords.
   * Only rendered when the bundler defines `import.meta.env.DEV`.
   */
  devPasswords?: Array<{ name: string; password: string }>;
}

export default function ReviewLogin({
  brand = 'Review',
  subtitle = 'Access restricted',
  accentColor = '#305B91',
  devPasswords,
}: ReviewLoginProps) {
  const { login, config } = useReview();
  const prefix = config.storageKeyPrefix;

  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(() => getLockSeconds(prefix));

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const t = setInterval(() => setLockSeconds(getLockSeconds(prefix)), 1000);
    return () => clearInterval(t);
  }, [lockSeconds, prefix]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (lockSeconds > 0) return;

    if (login(password, remember)) {
      clearRl(prefix);
    } else {
      const delay = recordFailure(prefix);
      setShake(true);
      setTimeout(() => setShake(false), 500);
      if (delay > 0) {
        setLockSeconds(delay);
        setError(`Too many attempts. Wait ${delay}s.`);
      } else {
        setError('Wrong password');
        setTimeout(() => setError(''), 3000);
      }
    }
  };

  const isDev = typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a1628]">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}
      />
      <div className={`relative w-full max-w-xs px-6 transition-transform ${shake ? 'wak-shake' : ''}`}>
        <div className="text-center">
          <div
            className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: `${accentColor}33` }}
          >
            <svg className="h-6 w-6" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-3xl font-light text-white" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}>
            {brand}
          </h1>
          <p className="mt-2 text-sm text-white/30">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-10">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={lockSeconds > 0}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-center text-sm text-white placeholder-white/25 outline-none transition focus:bg-white/[0.07] disabled:opacity-40"
            style={{ borderColor: lockSeconds > 0 ? undefined : undefined }}
            autoFocus
            autoComplete="current-password"
          />

          <label className="mt-4 flex cursor-pointer items-center justify-center gap-2">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-white/5"
              style={{ accentColor }}
            />
            <span className="text-xs text-white/30">Remember me</span>
          </label>

          <button
            type="submit"
            disabled={lockSeconds > 0}
            className="mt-4 w-full rounded-xl py-3.5 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
            style={{ backgroundColor: accentColor }}
          >
            {lockSeconds > 0 ? `Wait ${lockSeconds}s` : 'Enter'}
          </button>
          {error && <p className="mt-3 text-center text-sm text-red-400/80">{error}</p>}
        </form>

        {isDev && devPasswords && devPasswords.length > 0 && (
          <div className="mt-8 rounded-lg border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-white/20">Dev passwords</p>
            <div className="flex flex-wrap gap-2">
              {devPasswords.map((u) => (
                <button
                  key={u.name}
                  type="button"
                  onClick={() => setPassword(u.password)}
                  className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/40 transition hover:bg-white/10 hover:text-white/70"
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .wak-shake { animation: wak-shake 0.5s ease-in-out; }
        @keyframes wak-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
