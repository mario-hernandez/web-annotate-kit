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
    <div className="wak-login-root">
      <div className="wak-login-grid" aria-hidden="true" />
      <div className={`wak-login-card ${shake ? 'wak-login-shake' : ''}`}>
        <div className="wak-login-header">
          <div className="wak-login-lock" style={{ backgroundColor: `${accentColor}33` }}>
            <svg className="wak-login-lock-icon" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="wak-login-brand">{brand}</h1>
          <p className="wak-login-subtitle">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="wak-login-form">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={lockSeconds > 0}
            className="wak-login-input"
            autoFocus
            autoComplete="current-password"
          />

          <label className="wak-login-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="wak-login-check"
              style={{ accentColor }}
            />
            <span>Remember me</span>
          </label>

          <button
            type="submit"
            disabled={lockSeconds > 0}
            className="wak-login-submit"
            style={{ backgroundColor: accentColor }}
          >
            {lockSeconds > 0 ? `Wait ${lockSeconds}s` : 'Enter'}
          </button>
          {error && <p className="wak-login-error">{error}</p>}
        </form>

        {isDev && devPasswords && devPasswords.length > 0 && (
          <div className="wak-login-dev">
            <p className="wak-login-dev-title">Dev passwords</p>
            <div className="wak-login-dev-list">
              {devPasswords.map((u) => (
                <button
                  key={u.name}
                  type="button"
                  onClick={() => setPassword(u.password)}
                  className="wak-login-dev-btn"
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <LoginStyles accentColor={accentColor} />
    </div>
  );
}

function LoginStyles({ accentColor }: { accentColor: string }) {
  return (
    <style>{`
      .wak-login-root { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: #0a1628; font-family: system-ui, -apple-system, sans-serif; }
      .wak-login-root * { box-sizing: border-box; }
      .wak-login-grid { position: absolute; inset: 0; opacity: 0.03; background-image: radial-gradient(circle at 1px 1px, white 1px, transparent 0); background-size: 40px 40px; pointer-events: none; }
      .wak-login-card { position: relative; width: 100%; max-width: 320px; padding: 0 24px; transition: transform 0.15s; }
      .wak-login-shake { animation: wak-login-shake 0.5s ease-in-out; }
      .wak-login-header { text-align: center; }
      .wak-login-lock { margin: 0 auto 24px; display: flex; height: 48px; width: 48px; align-items: center; justify-content: center; border-radius: 9999px; }
      .wak-login-lock-icon { height: 24px; width: 24px; }
      .wak-login-brand { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 32px; font-weight: 300; color: white; margin: 0; line-height: 1.1; }
      .wak-login-subtitle { margin: 8px 0 0; font-size: 13px; color: rgba(255,255,255,0.3); }
      .wak-login-form { margin-top: 40px; display: flex; flex-direction: column; }
      .wak-login-input { width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); padding: 14px 16px; text-align: center; font-size: 13px; color: white; outline: none; transition: background 0.15s; font-family: inherit; }
      .wak-login-input::placeholder { color: rgba(255,255,255,0.25); }
      .wak-login-input:focus { background: rgba(255,255,255,0.07); }
      .wak-login-input:disabled { opacity: 0.4; }
      .wak-login-remember { margin-top: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; font-size: 12px; color: rgba(255,255,255,0.3); }
      .wak-login-check { height: 14px; width: 14px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); }
      .wak-login-submit { margin-top: 16px; width: 100%; border-radius: 12px; border: none; padding: 14px; font-size: 13px; font-weight: 500; color: white; cursor: pointer; transition: transform 0.1s; font-family: inherit; }
      .wak-login-submit:active { transform: scale(0.98); }
      .wak-login-submit:disabled { opacity: 0.4; cursor: not-allowed; }
      .wak-login-error { margin-top: 12px; text-align: center; font-size: 13px; color: rgba(248,113,113,0.8); }
      .wak-login-dev { margin-top: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.03); padding: 12px 16px; }
      .wak-login-dev-title { margin: 0 0 8px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.2); }
      .wak-login-dev-list { display: flex; flex-wrap: wrap; gap: 8px; }
      .wak-login-dev-btn { border-radius: 6px; border: none; background: rgba(255,255,255,0.05); padding: 4px 8px; font-size: 11px; color: rgba(255,255,255,0.4); cursor: pointer; transition: background 0.15s, color 0.15s; font-family: inherit; }
      .wak-login-dev-btn:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }

      @keyframes wak-login-shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-8px); }
        40% { transform: translateX(8px); }
        60% { transform: translateX(-4px); }
        80% { transform: translateX(4px); }
      }

      .wak-login-input:focus { border-color: ${accentColor}; }
    `}</style>
  );
}
