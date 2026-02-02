import React, { createContext, useContext, ReactNode } from 'react';

interface AuthContextType {
  onSignOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  onSignOut: () => void;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children, onSignOut }) => {
  return (
    <AuthContext.Provider value={{ onSignOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};