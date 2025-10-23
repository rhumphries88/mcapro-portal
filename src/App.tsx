import { useState, useEffect, createContext, useContext } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, useNavigate } from 'react-router-dom';
import { Building2, LogOut, User, ChevronDown } from 'lucide-react';

import SubmissionsPortal from './components/SubmissionsPortal';
import AdminPortal from './components/AdminPortal';
import AllDealsPortal from './components/AllDealsPortal';
import Login from './components/login';
import { logoutUser, supabase } from './lib/supabase';
import AccountSettingsModal from './components/AccountSettingsModal';

// Types
interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
}

interface LaunchParams {
  initialStep?: 'application' | 'bank' | 'intermediate' | 'matches' | 'recap';
  initialApplicationId?: string;
  lockedLenderIds?: string[];
}

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  isRegistering: boolean;
  showPendingApproval: boolean;
  setIsRegistering: (value: boolean) => void;
  setShowPendingApproval: (value: boolean) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// Auth Context
const AuthContext = createContext<AuthContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Auth Provider Component
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showPendingApproval, setShowPendingApproval] = useState(false);

  // Session restoration and persistence
  useEffect(() => {
    let mounted = true;
    
    // Prevent multiple initializations
    if (user && !loading) {
      console.log('Auth already initialized, skipping...');
      return;
    }

    const initializeAuth = async () => {
      try {
        // First, try to get session from Supabase
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Error getting session:', sessionError);
          if (mounted) {
            setLoading(false);
          }
          return;
        }

        if (session?.user && mounted) {
          await handleUserSession(session.user.id);
        } else if (mounted) {
          // No session found - only clear user if no stored user
          const hasStoredUser = localStorage.getItem('mcapro_user');
          if (!hasStoredUser) {
            setUser(null);
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        if (mounted) {
          setUser(null);
          setLoading(false);
        }
      }
    };

    const handleUserSession = async (userId: string) => {
      console.log('handleUserSession called for userId:', userId);
      try {
        console.log('Fetching user data from database...');
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name, email, roles, avatar_url')
          .eq('id', userId)
          .single();

        console.log('User data response:', { userData, error });

        if (!mounted) {
          console.log('Component unmounted, returning early');
          return;
        }

        if (!error && userData) {
          // If user has no role assigned, don't authenticate and show popup
          if (!userData.roles) {
            console.log('User has no role assigned, showing pending approval');
            await supabase.auth.signOut();
            setUser(null);
            setShowPendingApproval(true);
            setLoading(false);
            return;
          }

          // User has a role, set user info and authenticate
          const userInfo: UserInfo = {
            id: userId,
            name: userData.full_name,
            email: userData.email,
            role: userData.roles,
            avatarUrl: userData.avatar_url ?? null
          };

          console.log('Setting user info:', userInfo);
          setUser(userInfo);
          
          // Persist user info to localStorage for faster restoration
          localStorage.setItem('mcapro_user', JSON.stringify(userInfo));
          console.log('User authentication successful');
          
          // Authentication successful - no need to clear timeout here
        } else {
          console.log('No user data found or error occurred');
          setUser(null);
          localStorage.removeItem('mcapro_user');
        }
      } catch (error) {
        console.error('Error checking user role:', error);
        if (mounted) {
          setUser(null);
          localStorage.removeItem('mcapro_user');
        }
      } finally {
        if (mounted) {
          console.log('Setting loading to false');
          setLoading(false);
        }
      }
    };

    // Try to restore user from localStorage first for faster UI
    const storedUser = localStorage.getItem('mcapro_user');
    if (storedUser && !user) { // Only restore if no user is already set
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        // Set loading to false immediately if we have stored user
        setLoading(false);
        console.log('Restored user from localStorage:', parsedUser);
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('mcapro_user');
      }
    }

    // Initialize auth (this will validate the stored session)
    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        // Ignore auth state changes during registration process
        if (isRegistering) {
          return;
        }

        console.log('Auth state change:', event, session?.user?.id);

        if (event === 'SIGNED_OUT' || !session?.user) {
          console.log('User signed out, clearing state');
          setUser(null);
          localStorage.removeItem('mcapro_user');
          localStorage.removeItem('mcapro-auth-token');
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          console.log('Processing auth state change for user:', session.user.id);
          await handleUserSession(session.user.id);
        } else if (event === 'INITIAL_SESSION' && session?.user) {
          console.log('Processing initial session for user:', session.user.id);
          await handleUserSession(session.user.id);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isRegistering, loading, user]);

  const logout = async () => {
    console.log('Logging out user...');
    
    // Clear all possible auth-related localStorage items
    setUser(null);
    setLoading(false);
    localStorage.clear(); // Clear everything to prevent any cached data issues
    sessionStorage.clear(); // Also clear session storage
    console.log('User state and all storage cleared');
    
    // Try Supabase logout in background
    try {
      await logoutUser();
      console.log('Supabase logout completed');
    } catch (error) {
      console.error('Supabase logout error (but user is still logged out locally):', error);
    }
    
    console.log('Logout successful');
  };

  const value: AuthContextType = {
    user,
    loading,
    isRegistering,
    showPendingApproval,
    setIsRegistering,
    setShowPendingApproval,
    logout,
    refreshUser: async () => {
      if (!user) return;
      const { data: userData } = await supabase
        .from('users')
        .select('full_name, email, roles, avatar_url')
        .eq('id', user.id)
        .single();
      if (userData) {
        const updated: UserInfo = { id: user.id, name: userData.full_name, email: userData.email, role: userData.roles, avatarUrl: userData.avatar_url ?? null };
        setUser(updated);
        localStorage.setItem('mcapro_user', JSON.stringify(updated));
      }
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Public Route Component (redirects to dashboard if authenticated)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

// Login Page Component
function LoginPage() {
  const { showPendingApproval, setIsRegistering, setShowPendingApproval } = useAuth();

  return (
    <Login 
      onRegistrationStart={() => setIsRegistering(true)}
      onRegistrationEnd={() => setIsRegistering(false)}
      showPendingApproval={showPendingApproval}
      onClosePendingApproval={() => setShowPendingApproval(false)}
    />
  );
}

// Dashboard Layout Component
function DashboardLayout() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [currentPortal, setCurrentPortal] = useState<'submissions' | 'deals' | 'admin'>('submissions');
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [launchParams, setLaunchParams] = useState<LaunchParams | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Redirect non-admin users away from admin portal
  useEffect(() => {
    if (user && currentPortal === 'admin') {
      const isAdmin = user.role === 'admin' || user.role === 'Admin';
      if (!isAdmin) {
        setCurrentPortal('submissions');
      }
    }
  }, [user, currentPortal]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showUserDropdown && !target.closest('.user-dropdown')) {
        setShowUserDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserDropdown]);

  const handleLogout = async () => {
    try {
      await logout();
      setShowUserDropdown(false);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header Navigation */}
      <div className="bg-white shadow-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            {/* Logo Section */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl shadow-lg">
                <Building2 className="h-7 w-7 text-white" />
              </div>
              <div>
                <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">MCAPortal Pro</span>
                <div className="text-xs text-gray-500 font-medium">Professional Dashboard</div>
              </div>
            </div>

            {/* Navigation & User Section */}
            <div className="flex items-center space-x-8">
              {/* Portal Navigation */}
              <nav className="flex items-center space-x-2 bg-gray-50 p-1 rounded-2xl border border-gray-200">
                <button
                  onClick={() => {
                    setLaunchParams(null);
                    setCurrentPortal('submissions');
                  }}
                  className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 relative overflow-hidden ${
                    currentPortal === 'submissions'
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:text-blue-600 hover:bg-white hover:shadow-md'
                  }`}
                >
                  {currentPortal === 'submissions' && (
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 animate-pulse"></div>
                  )}
                  <span className="relative">Submissions Portal</span>
                </button>
                <button
                  onClick={() => {
                    setLaunchParams(null);
                    setCurrentPortal('deals');
                  }}
                  className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 relative overflow-hidden ${
                    currentPortal === 'deals'
                      ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:text-purple-600 hover:bg-white hover:shadow-md'
                  }`}
                >
                  {currentPortal === 'deals' && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 animate-pulse"></div>
                  )}
                  <span className="relative">All Deals</span>
                </button>
                {/* Admin Portal - Only show for admin users */}
                {user && (user.role === 'admin' || user.role === 'Admin') && (
                  <button
                    onClick={() => {
                      setLaunchParams(null);
                      setCurrentPortal('admin');
                    }}
                    className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 relative overflow-hidden ${
                      currentPortal === 'admin'
                        ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-lg transform scale-105'
                        : 'text-gray-600 hover:text-emerald-600 hover:bg-white hover:shadow-md'
                    }`}
                  >
                    {currentPortal === 'admin' && (
                      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 animate-pulse"></div>
                    )}
                    <span className="relative">Admin Portal</span>
                  </button>
                )}
              </nav>
              
              {/* User Dropdown */}
              <div className="relative">
                <div className="relative user-dropdown">
                  <button
                    onClick={() => setShowUserDropdown(!showUserDropdown)}
                    className="flex items-center space-x-3 px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 hover:from-white hover:to-gray-50 rounded-2xl border border-gray-200 hover:border-blue-300 transition-all duration-300 shadow-sm hover:shadow-md group"
                  >
                    <div className="relative">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="avatar" className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-md ring-2 ring-blue-100 group-hover:ring-blue-200 transition-all" />
                      ) : (
                        <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full border-2 border-white shadow-md ring-2 ring-blue-100 group-hover:ring-blue-200 transition-all">
                          <User className="h-5 w-5 text-blue-600" />
                        </div>
                      )}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-white rounded-full"></div>
                    </div>
                    <div className="hidden sm:block text-left">
                      <div className="text-sm font-semibold text-gray-900">{user.name}</div>
                      <div className="text-xs text-gray-500 capitalize">{user.role}</div>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-400 group-hover:text-blue-500 transition-all duration-300 ${showUserDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showUserDropdown && (
                    <div className="absolute right-0 top-full mt-3 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-in slide-in-from-top-2 duration-200">
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-100">
                        <div className="flex items-center space-x-3">
                          {user.avatarUrl ? (
                            <img src={user.avatarUrl} alt="avatar" className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-md" />
                          ) : (
                            <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full border-2 border-white shadow-md">
                              <User className="h-6 w-6 text-blue-600" />
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-gray-900">{user.name}</div>
                            <div className="text-sm text-blue-600 font-medium capitalize">{user.role}</div>
                          </div>
                        </div>
                      </div>
                      <div className="py-2">
                        <button
                          onClick={() => { setShowAccountModal(true); setShowUserDropdown(false); }}
                          className="w-full text-left px-6 py-3 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-3 font-medium"
                        >
                          <User className="h-4 w-4" />
                          Account Settings
                        </button>
                        <button
                          onClick={handleLogout}
                          className="w-full text-left px-6 py-3 text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center gap-3 transition-colors font-medium"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Portal Content */}
      {currentPortal === 'submissions' && (
        <SubmissionsPortal
          initialStep={launchParams?.initialStep}
          initialApplicationId={launchParams?.initialApplicationId}
          lockedLenderIds={launchParams?.lockedLenderIds}
        />
      )}
      {currentPortal === 'deals' && (
        <AllDealsPortal
          onEditDeal={({ applicationId, lockedLenderIds }) => {
            setLaunchParams({ initialStep: 'intermediate', initialApplicationId: applicationId, lockedLenderIds });
            setCurrentPortal('submissions');
          }}
          onViewQualifiedLenders={({ applicationId, lockedLenderIds }) => {
            setLaunchParams({ initialStep: 'matches', initialApplicationId: applicationId, lockedLenderIds });
            setCurrentPortal('submissions');
          }}
        />
      )}
      {currentPortal === 'admin' && user && (user.role === 'admin' || user.role === 'Admin') && <AdminPortal />}
      {user && (
        <AccountSettingsModal
          open={showAccountModal}
          onClose={() => setShowAccountModal(false)}
          userId={user.id}
          onSaved={async () => {
            await refreshUser();
          }}
        />
      )}
    </div>
  );
}

// Router Configuration
const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <PublicRoute>
        <LoginPage />
      </PublicRoute>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: <Navigate to="/dashboard" replace />,
  },
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />,
  },
]);

// Main App Component
function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

export default App;