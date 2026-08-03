import { useEffect, useState } from 'react';
import { useAuth, useSignIn, useSignUp } from '@clerk/clerk-react';
import { setClerkTokenGetter } from '../../lib/clerkAuthBridge.js';

function extractClerkErrorMessage(error, fallback) {
  return error?.errors?.[0]?.longMessage || error?.errors?.[0]?.message || fallback;
}

export function AuthPanel({ text, onAuthenticated }) {
  const { isLoaded: authLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();

  const [mode, setMode] = useState('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      setClerkTokenGetter(getToken);
    } else {
      setClerkTokenGetter(null);
    }

    return () => setClerkTokenGetter(null);
  }, [authLoaded, isSignedIn, getToken]);

  const handleSignIn = async (event) => {
    event.preventDefault();
    if (!signInLoaded || pending) {
      return;
    }

    setPending(true);
    setError('');

    try {
      const attempt = await signIn.create({ identifier: email, password });

      if (attempt.status === 'complete') {
        await setActiveSignIn({ session: attempt.createdSessionId });
        setPassword('');
        onAuthenticated?.();
      } else {
        setError(text.authGenericError);
      }
    } catch (signInError) {
      setError(extractClerkErrorMessage(signInError, text.authGenericError));
    } finally {
      setPending(false);
    }
  };

  const handleSignUp = async (event) => {
    event.preventDefault();
    if (!signUpLoaded || pending) {
      return;
    }

    setPending(true);
    setError('');

    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setMode('verify');
    } catch (signUpError) {
      setError(extractClerkErrorMessage(signUpError, text.authGenericError));
    } finally {
      setPending(false);
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    if (!signUpLoaded || pending) {
      return;
    }

    setPending(true);
    setError('');

    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code });

      if (attempt.status === 'complete') {
        await setActiveSignUp({ session: attempt.createdSessionId });
        setPassword('');
        setCode('');
        setMode('signIn');
        onAuthenticated?.();
      } else {
        setError(text.authGenericError);
      }
    } catch (verifyError) {
      setError(extractClerkErrorMessage(verifyError, text.authGenericError));
    } finally {
      setPending(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setClerkTokenGetter(null);
  };

  if (!authLoaded) {
    return null;
  }

  if (isSignedIn) {
    return (
      <div className="auth-panel auth-panel--signed-in">
        <button
          type="button"
          className="settings-action"
          onClick={() => {
            void handleSignOut();
          }}
        >
          {text.authSignOut}
        </button>
      </div>
    );
  }

  if (mode === 'verify') {
    return (
      <form className="auth-panel" onSubmit={handleVerify}>
        <p className="auth-panel__hint">{text.authVerifyHint}</p>
        <input
          className="auth-panel__input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={text.authVerifyCodePlaceholder}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
        {error ? <p className="auth-panel__error">{error}</p> : null}
        <button type="submit" className="settings-action" disabled={pending}>
          {pending ? text.authPending : text.authVerifyButton}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-panel" onSubmit={mode === 'signUp' ? handleSignUp : handleSignIn}>
      <input
        className="auth-panel__input"
        type="email"
        placeholder={text.authEmailPlaceholder}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
      />
      <input
        className="auth-panel__input"
        type="password"
        placeholder={text.authPasswordPlaceholder}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
        required
      />
      {mode === 'signUp' ? <div id="clerk-captcha" /> : null}
      {error ? <p className="auth-panel__error">{error}</p> : null}
      <button type="submit" className="settings-action" disabled={pending}>
        {pending ? text.authPending : mode === 'signUp' ? text.authSignUpButton : text.authSignInButton}
      </button>
      <button
        type="button"
        className="auth-panel__switch"
        onClick={() => {
          setMode(mode === 'signUp' ? 'signIn' : 'signUp');
          setError('');
        }}
      >
        {mode === 'signUp' ? text.authSwitchToSignIn : text.authSwitchToSignUp}
      </button>
    </form>
  );
}
