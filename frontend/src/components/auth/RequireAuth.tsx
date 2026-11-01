/**
 * Predict IQ - Protected route guard.
 *
 * UX layer only: it blocks private dashboard rendering until the session is
 * restored, and forwards unauthenticated visitors to /signin while preserving
 * the intended destination. Backend authorization stays authoritative.
 */

import React, { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuthGuardDecision } from '../../lib/authGuard';
import { AuthConfigErrorScreen, AuthLoadingScreen } from './AuthScreens';

interface RequireAuthProps {
  children: React.ReactNode;
  /** Called once when an unauthenticated visitor reaches a private route. */
  onBlocked: (currentPath: string) => void;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children, onBlocked }) => {
  const { status, configError } = useAuth();
  const decision = getAuthGuardDecision(status);
  const blockedFor = useRef<string | null>(null);

  useEffect(() => {
    if (decision !== 'redirect-signin') {
      blockedFor.current = null;
      return;
    }
    const current = `${window.location.pathname}${window.location.search}`;
    if (blockedFor.current === current) return;
    blockedFor.current = current;
    onBlocked(current);
  }, [decision, onBlocked]);

  if (configError) {
    return <AuthConfigErrorScreen message={configError} />;
  }
  if (decision !== 'render') {
    // 'loading' and the one-frame 'redirect-signin' both render the neutral
    // loading screen: private content is never shown before restoration.
    return <AuthLoadingScreen />;
  }
  return <>{children}</>;
};

export default RequireAuth;
