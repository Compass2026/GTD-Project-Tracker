/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthGate — wraps the app and requires a Supabase login before rendering it.
 * Uses the same Supabase Auth account as the Routine Tracker app.
 * The session persists in the browser, so login is a one-time step per device.
 */

import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Zap } from 'lucide-react';
import { supabase } from './supabaseClient';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Restore any saved session, then listen for changes.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Email or password is incorrect.'
          : signInError.message,
      );
    }
    setSubmitting(false);
  }

  // Brief blank state while restoring a saved session (avoids login-form flash).
  if (checking) {
    return <div className="min-h-screen bg-[#0b0d12]" />;
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0b0d12] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#12151c] p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-violet-600 flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white">Compass GTD</h1>
          </div>
          <p className="text-sm text-gray-400 mb-6">Sign in to see your board.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-violet-500"
            />
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-violet-500"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 py-2.5 text-sm font-medium text-white transition-colors"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
