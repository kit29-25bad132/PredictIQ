import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import {
  auth,
  googleProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  formatAuthError,
  getPersonalizedGreeting,
  User,
} from '../services/firebase';
import api from '../services/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  greeting: string;
  userName: string;
  initials: string;
  photoURL: string | null;
  authError: string | null;
  setAuthError: (error: string | null) => void;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      
      // If user is logged in, optionally check/establish backend session
      if (currentUser) {
        api.checkSession().catch(() => {
          // Backend session check is optional for frontend telemetry reads
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const { greeting, name: userName, initials } = useMemo(() => {
    return getPersonalizedGreeting(user?.displayName, user?.email);
  }, [user?.displayName, user?.email]);

  const signInWithEmail = async (email: string, password: string): Promise<User> => {
    setAuthError(null);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      setUser(userCredential.user);
      return userCredential.user;
    } catch (err: any) {
      const friendlyMsg = formatAuthError(err);
      setAuthError(friendlyMsg);
      throw new Error(friendlyMsg);
    }
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    fullName: string
  ): Promise<User> => {
    setAuthError(null);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const createdUser = userCredential.user;

      if (fullName.trim()) {
        await updateProfile(createdUser, {
          displayName: fullName.trim(),
        });
      }

      // Try sending email verification
      try {
        await sendEmailVerification(createdUser);
      } catch {
        // Verification email send failure is non-blocking for account creation
      }

      setUser({ ...createdUser, displayName: fullName.trim() } as User);
      return createdUser;
    } catch (err: any) {
      const friendlyMsg = formatAuthError(err);
      setAuthError(friendlyMsg);
      throw new Error(friendlyMsg);
    }
  };

  const signInWithGoogle = async (): Promise<User> => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
      return result.user;
    } catch (err: any) {
      const friendlyMsg = formatAuthError(err);
      setAuthError(friendlyMsg);
      throw new Error(friendlyMsg);
    }
  };

  const sendPasswordReset = async (email: string): Promise<void> => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: any) {
      const friendlyMsg = formatAuthError(err);
      setAuthError(friendlyMsg);
      throw new Error(friendlyMsg);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await firebaseSignOut(auth);
      try {
        await api.logout();
      } catch {
        // Ignore backend logout error
      }
      setUser(null);
    } catch (err: any) {
      console.error('Logout error:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        greeting,
        userName,
        initials,
        photoURL: user?.photoURL || null,
        authError,
        setAuthError,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        sendPasswordReset,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
export default AuthContext;
