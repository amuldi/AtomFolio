import { useEffect, useState } from 'react';
import { useAuth, useSignIn, useSignUp, useUser } from '@clerk/clerk-react';
import { setClerkTokenGetter } from '../../lib/clerkAuthBridge.js';

const SUPPORT_EMAIL = String(import.meta.env.VITE_ATOMFOLIO_SUPPORT_EMAIL ?? '').trim();

function extractClerkErrorMessage(error, fallback) {
  return error?.errors?.[0]?.longMessage || error?.errors?.[0]?.message || fallback;
}

// Clerk's own error copy is already written for end users, but this still guards against a
// future response shape leaking raw technical detail (stack-trace-like text, embedded newlines,
// an unbounded string) straight into a financial app's auth UI unexamined.
function sanitizeErrorMessage(message) {
  const value = String(message ?? '').trim();
  if (!value) {
    return '';
  }
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 240);
}

export function AuthPanel({ text, onAuthenticated, workspaceId }) {
  const { isLoaded: authLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const { user } = useUser();

  // mode: 'signIn' | 'signUp' | 'verify' | 'forgotPassword' | 'resetPassword'
  const [mode, setMode] = useState('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [resetRequestSent, setResetRequestSent] = useState(false);

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      setClerkTokenGetter(getToken);
    } else {
      setClerkTokenGetter(null);
    }

    return () => setClerkTokenGetter(null);
  }, [authLoaded, isSignedIn, getToken]);

  const resetTransientFields = () => {
    setPassword('');
    setNewPassword('');
    setCode('');
    setResetRequestSent(false);
  };

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
      setError(sanitizeErrorMessage(extractClerkErrorMessage(signInError, text.authGenericError)));
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
      setError(sanitizeErrorMessage(extractClerkErrorMessage(signUpError, text.authGenericError)));
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
      setError(sanitizeErrorMessage(extractClerkErrorMessage(verifyError, text.authGenericError)));
    } finally {
      setPending(false);
    }
  };

  // Password reset is a two-step headless flow against the *sign-in* resource (Clerk models
  // "forgot password" as a first-factor strategy on signIn, not on signUp): first request a code
  // by email, then attempt the first factor with that code plus the new password.
  const handleRequestPasswordReset = async (event) => {
    event.preventDefault();
    if (!signInLoaded || pending) {
      return;
    }

    setPending(true);
    setError('');

    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email });
      setResetRequestSent(true);
      setMode('resetPassword');
    } catch (resetRequestError) {
      setError(sanitizeErrorMessage(extractClerkErrorMessage(resetRequestError, text.authGenericError)));
    } finally {
      setPending(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    if (!signInLoaded || pending) {
      return;
    }

    setPending(true);
    setError('');

    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
        password: newPassword,
      });

      if (attempt.status === 'complete') {
        await setActiveSignIn({ session: attempt.createdSessionId });
        resetTransientFields();
        setMode('signIn');
        onAuthenticated?.();
      } else {
        setError(text.authGenericError);
      }
    } catch (resetError) {
      setError(sanitizeErrorMessage(extractClerkErrorMessage(resetError, text.authGenericError)));
    } finally {
      setPending(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setClerkTokenGetter(null);
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    resetTransientFields();
  };

  if (!authLoaded) {
    return null;
  }

  if (isSignedIn) {
    const identityLabel = user?.primaryEmailAddress?.emailAddress || user?.id || '';
    const deleteRequestBody = [
      text.authDeleteAccountEmailBody,
      workspaceId ? `Workspace ID: ${workspaceId}` : null,
      identityLabel ? `Account: ${identityLabel}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return (
      <div className="auth-panel auth-panel--signed-in">
        {identityLabel ? (
          <p className="auth-panel__identity" title={identityLabel}>
            {identityLabel}
          </p>
        ) : null}
        <button
          type="button"
          className="settings-action"
          onClick={() => {
            void handleSignOut();
          }}
        >
          {text.authSignOut}
        </button>
        <div className="auth-panel__danger-zone">
          <p className="auth-panel__danger-title">{text.authDeleteAccountTitle}</p>
          <p className="auth-panel__hint">{text.authDeleteAccountHint}</p>
          {SUPPORT_EMAIL ? (
            <a
              className="auth-panel__danger-action"
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(text.authDeleteAccountEmailSubject)}&body=${encodeURIComponent(deleteRequestBody)}`}
            >
              {text.authDeleteAccountButton}
            </a>
          ) : (
            <button type="button" className="auth-panel__danger-action" disabled title={text.authDeleteAccountUnavailable}>
              {text.authDeleteAccountButton}
            </button>
          )}
          {!SUPPORT_EMAIL ? <p className="auth-panel__hint">{text.authDeleteAccountUnavailable}</p> : null}
        </div>
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

  if (mode === 'forgotPassword') {
    return (
      <form className="auth-panel" onSubmit={handleRequestPasswordReset}>
        <p className="auth-panel__hint">{text.authForgotPasswordHint}</p>
        <input
          className="auth-panel__input"
          type="email"
          placeholder={text.authEmailPlaceholder}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
        {error ? <p className="auth-panel__error">{error}</p> : null}
        <button type="submit" className="settings-action" disabled={pending}>
          {pending ? text.authPending : text.authSendResetCodeButton}
        </button>
        <button type="button" className="auth-panel__switch" onClick={() => switchMode('signIn')}>
          {text.authBackToSignIn}
        </button>
      </form>
    );
  }

  if (mode === 'resetPassword') {
    return (
      <form className="auth-panel" onSubmit={handleResetPassword}>
        <p className="auth-panel__hint">
          {resetRequestSent ? text.authResetCodeSentHint : text.authVerifyHint}
        </p>
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
        <input
          className="auth-panel__input"
          type="password"
          placeholder={text.authNewPasswordPlaceholder}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          required
        />
        {error ? <p className="auth-panel__error">{error}</p> : null}
        <button type="submit" className="settings-action" disabled={pending}>
          {pending ? text.authPending : text.authResetPasswordButton}
        </button>
        <button type="button" className="auth-panel__switch" onClick={() => switchMode('signIn')}>
          {text.authBackToSignIn}
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
      <div className="auth-panel__links">
        <button
          type="button"
          className="auth-panel__switch"
          onClick={() => switchMode(mode === 'signUp' ? 'signIn' : 'signUp')}
        >
          {mode === 'signUp' ? text.authSwitchToSignIn : text.authSwitchToSignUp}
        </button>
        {mode === 'signIn' ? (
          <button type="button" className="auth-panel__switch" onClick={() => switchMode('forgotPassword')}>
            {text.authForgotPasswordLink}
          </button>
        ) : null}
      </div>
    </form>
  );
}
