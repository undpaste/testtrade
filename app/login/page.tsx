'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        router.replace('/trade');
        return;
      }

      setLoading(false);
    };

    checkSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      if (isSigningUp) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.session) {
          router.replace('/trade');
        } else {
          setSuccessMessage('Check your email to confirm your account, then sign in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace('/trade');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-[#0B0E11] p-10 text-white">Checking session...</div>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0E11] p-6 text-white">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-5 rounded-lg border border-gray-700 bg-gray-900 p-8">
        <div>
          <h1 className="text-2xl font-bold text-green-400">TestTrade</h1>
          <p className="mt-2 text-gray-300">{isSigningUp ? 'Create an account' : 'Sign in to your account'}</p>
        </div>

        <label className="block space-y-2">
          <span>Email</span>
          <input
            autoComplete="email"
            className="w-full rounded border border-gray-600 bg-black px-3 py-2"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label className="block space-y-2">
          <span>Password</span>
          <input
            autoComplete={isSigningUp ? 'new-password' : 'current-password'}
            className="w-full rounded border border-gray-600 bg-black px-3 py-2"
            minLength={6}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        {errorMessage && <p role="alert" className="text-red-400">{errorMessage}</p>}
        {successMessage && <p role="status" className="text-green-400">{successMessage}</p>}

        <button
          className="w-full rounded bg-green-600 px-4 py-2 font-bold hover:bg-green-500 disabled:opacity-50"
          disabled={submitting}
          type="submit"
        >
          {submitting ? 'Please wait...' : isSigningUp ? 'Create account' : 'Sign in'}
        </button>

        <button
          className="w-full text-sm text-gray-300 underline"
          onClick={() => {
            setIsSigningUp(!isSigningUp);
            setErrorMessage('');
            setSuccessMessage('');
          }}
          type="button"
        >
          {isSigningUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
        </button>
      </form>
    </main>
  );
}