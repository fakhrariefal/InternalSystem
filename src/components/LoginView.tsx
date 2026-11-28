import { Languages, Lock, LogIn, UserPlus } from 'lucide-react';
import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

interface LoginViewProps {
  onEmailLogin: (email: string, password: string) => Promise<boolean>;
  onEmailRegister: (input: {
    displayName: string;
    companyName: string;
    email: string;
    password: string;
  }) => Promise<boolean>;
  onGoogleLogin?: () => Promise<void>;
  busy: boolean;
  error: string | null;
  infoMessage?: string | null;
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function LoginView({
  onEmailLogin,
  onEmailRegister,
  onGoogleLogin,
  busy,
  error,
  infoMessage,
}: LoginViewProps) {
  const { lang, setLang, tr } = useI18n();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('PT Domestiq Hub Indonesia');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'login') {
      await onEmailLogin(email, password);
    } else {
      const ok = await onEmailRegister({
        displayName,
        companyName,
        email,
        password,
      });
      if (ok) {
        setPassword('');
      }
    }
  };

  return (
    <div className="min-h-dvh flex flex-col bg-[#F4F7FB] text-[#0B1B3A] relative overflow-x-hidden">
      {/* Subtle top corporate hairline */}
      <div className="h-1 w-full bg-[#0B1B3A]" />

      {/* Minimal Top Bar with Language Switcher */}
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <img
            src="/assets/aistudio/image_adf18c6a.png"
            alt="DQH"
            referrerPolicy="no-referrer"
            className="h-5 w-auto object-contain"
          />
          <span className="hidden sm:inline text-slate-400">·</span>
          <span className="hidden sm:inline">General Supplier ERP</span>
        </div>

        <div
          role="group"
          aria-label={tr('Pilih bahasa', 'Select language')}
          className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs"
        >
          <Languages className="h-3.5 w-3.5 text-slate-400 ml-2 mr-1" aria-hidden="true" />
          {(['id', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={cn(
                'min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer',
                lang === code
                  ? 'bg-[#0B1B3A] text-white'
                  : 'text-slate-600 hover:text-[#0B1B3A] hover:bg-slate-50'
              )}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* Centered Single-Focus Login / Register Card */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-10">
        <div className="w-full max-w-[440px]">
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-[0_12px_36px_-12px_rgba(11,27,58,0.12)] overflow-hidden">
            {/* Subtle Gold-to-Navy Accent Bar */}
            <div className="h-[3px] w-full bg-gradient-to-r from-[#0B1B3A] via-[#1B5E99] to-[#D9AA32]" />

            <div className="p-6 sm:p-8 space-y-5">
              {/* Brand Logo */}
              <div className="flex justify-center pt-1">
                <img
                  src="/assets/aistudio/image_21c89ab0.png"
                  alt="PT Domestiq Hub Indonesia"
                  referrerPolicy="no-referrer"
                  className="h-10 sm:h-11 w-auto max-w-full object-contain"
                />
              </div>

              {/* Heading */}
              <div className="text-center space-y-1">
                <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-[#0B1B3A]">
                  {tr('Portal Internal ERP', 'Internal ERP Portal')}
                </h1>
                <p className="text-xs sm:text-[13px] text-slate-500 leading-relaxed">
                  {mode === 'login'
                    ? tr(
                        'Masuk dengan akun terdaftar untuk mengakses sistem operasional & keuangan.',
                        'Sign in with your registered account to access operations & accounting.'
                      )
                    : tr(
                        'Buat akun & workspace perusahaan baru atau klaim undangan tim dari Direktur.',
                        'Create a new account & company workspace or claim a team invitation.'
                      )}
                </p>
              </div>

              {/* Login / Register Mode Switcher */}
              <div
                role="tablist"
                aria-label={tr('Mode otentikasi', 'Authentication mode')}
                className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  onClick={() => setMode('login')}
                  className={cn(
                    'min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer',
                    mode === 'login'
                      ? 'bg-white text-[#0B1B3A] shadow-xs'
                      : 'text-slate-600 hover:text-[#0B1B3A]'
                  )}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  {tr('Masuk (Login)', 'Sign In')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  onClick={() => setMode('register')}
                  className={cn(
                    'min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer',
                    mode === 'register'
                      ? 'bg-white text-[#0B1B3A] shadow-xs'
                      : 'text-slate-600 hover:text-[#0B1B3A]'
                  )}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {tr('Daftar Akun', 'Register')}
                </button>
              </div>

              {/* Error / Info Feedback */}
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50/90 px-3.5 py-2.5 text-xs text-red-700 leading-relaxed"
                >
                  {error}
                </div>
              )}

              {infoMessage && (
                <div
                  role="status"
                  className="rounded-lg border border-emerald-200 bg-emerald-50/90 px-3.5 py-2.5 text-xs text-emerald-800 leading-relaxed"
                >
                  {infoMessage}
                </div>
              )}

              {/* Email / Password Form */}
              <form onSubmit={handleSubmit} className="space-y-3.5">
                {mode === 'register' && (
                  <>
                    <div className="space-y-1">
                      <label htmlFor="auth-display-name" className="block text-xs font-semibold text-[#0B1B3A]">
                        {tr('Nama Lengkap', 'Full Name')}
                      </label>
                      <input
                        id="auth-display-name"
                        type="text"
                        required
                        minLength={2}
                        maxLength={120}
                        placeholder={tr('Contoh: Fakhri Ariefal', 'e.g. Fakhri Ariefal')}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0B1B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E99]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="auth-company-name" className="block text-xs font-semibold text-[#0B1B3A]">
                        {tr('Nama Perusahaan', 'Company Name')}
                      </label>
                      <input
                        id="auth-company-name"
                        type="text"
                        required
                        minLength={2}
                        maxLength={160}
                        placeholder="PT Domestiq Hub Indonesia"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0B1B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E99]"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1">
                  <label htmlFor="auth-email" className="block text-xs font-semibold text-[#0B1B3A]">
                    {tr('Email Perusahaan', 'Corporate Email')}
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="nama@perusahaan.co.id"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full min-h-[42px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0B1B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E99]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="auth-password" className="block text-xs font-semibold text-[#0B1B3A]">
                    {tr('Kata Sandi', 'Password')}
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={tr('Minimal 6 karakter', 'Minimum 6 characters')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full min-h-[42px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0B1B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E99]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className={cn(
                    'w-full min-h-[46px] px-4 py-2.5 rounded-xl font-semibold text-sm',
                    'bg-[#0B1B3A] text-white hover:bg-[#13284F] active:bg-[#08142B]',
                    'transition-colors flex items-center justify-center gap-2 cursor-pointer',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B5E99] focus-visible:ring-offset-2',
                    'disabled:opacity-60 disabled:cursor-not-allowed'
                  )}
                >
                  {mode === 'login' ? (
                    <>
                      <LogIn className="h-4 w-4" />
                      <span>
                        {busy
                          ? tr('Memverifikasi sesi...', 'Verifying session...')
                          : tr('Masuk ke Sistem ERP', 'Sign In to ERP')}
                      </span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      <span>
                        {busy
                          ? tr('Mendaftarkan akun...', 'Registering account...')
                          : tr('Daftar & Buat Workspace', 'Register & Create Workspace')}
                      </span>
                    </>
                  )}
                </button>
              </form>

              {onGoogleLogin && (
                <>
                  <div className="relative flex items-center py-0.5">
                    <div className="flex-grow border-t border-slate-200" />
                    <span className="mx-3 shrink text-[11px] font-medium text-slate-400 uppercase">
                      {tr('atau', 'or')}
                    </span>
                    <div className="flex-grow border-t border-slate-200" />
                  </div>

                  <button
                    type="button"
                    onClick={onGoogleLogin}
                    disabled={busy}
                    className={cn(
                      'w-full min-h-[42px] px-4 py-2 rounded-xl font-semibold text-xs',
                      'border border-slate-200 bg-white text-[#0B1B3A] hover:bg-slate-50',
                      'transition-colors flex items-center justify-center gap-2.5 cursor-pointer',
                      'disabled:opacity-60 disabled:cursor-not-allowed'
                    )}
                  >
                    <GoogleMark />
                    <span>{tr('Lanjutkan dengan Google (OAuth)', 'Continue with Google (OAuth)')}</span>
                  </button>
                </>
              )}

              {/* Calm Single-Line Access Note */}
              <div className="pt-3 border-t border-slate-100 flex items-start gap-2 text-[11.5px] text-slate-500 leading-relaxed">
                <Lock className="h-3.5 w-3.5 text-[#1B5E99] shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {tr(
                    'Otentikasi & isolasi data multi-tenant diamankan melalui Supabase Auth + Row Level Security (RBAC 8-Role).',
                    'Authentication & multi-tenant data isolation secured via Supabase Auth + Row Level Security (8-Role RBAC).'
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="pb-5 px-4 text-center text-[11px] text-slate-400">
        © {new Date().getFullYear()} PT Domestiq Hub Indonesia · Internal Procurement, Inventory &amp; Accounting
      </footer>
    </div>
  );
}
