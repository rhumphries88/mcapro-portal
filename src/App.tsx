import { useState, useEffect, createContext, useContext } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, useNavigate } from 'react-router-dom';
import { Building2, LogOut, User, ChevronDown } from 'lucide-react';

import SubmissionsPortal from './components/SubmissionsPortal';
import AdminPortal from './components/AdminPortal';
import AllDealsPortal from './components/AllDealsPortal';
import Login from './components/login';
import { logoutUser, supabase } from './lib/supabase';

// Types
interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
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
          .select('full_name, email, roles')
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
            role: userData.roles
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
    logout
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPortal, setCurrentPortal] = useState<'submissions' | 'deals' | 'admin'>('submissions');
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [launchParams, setLaunchParams] = useState<LaunchParams | null>(null);

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
      {/* Portal Toggle */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-3">
            {/* Logo Section */}
            <div className="flex items-center space-x-3">
              <div className="flex items-center justify-center w-10 h-10 bg-blue-600 rounded-lg">
                <Building2 className="h-6 w-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">MCAPortal Pro</span>
            </div>

            {/* Navigation & User Section */}
            <div className="flex items-center space-x-6">
              {/* Portal Navigation */}
              <nav className="flex items-center space-x-1">
                <button
                  onClick={() => {
                    setLaunchParams(null);
                    setCurrentPortal('submissions');
                  }}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                    currentPortal === 'submissions'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  Submissions Portal
                </button>
                <button
                  onClick={() => {
                    setLaunchParams(null);
                    setCurrentPortal('deals');
                  }}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                    currentPortal === 'deals'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  All Deals
                </button>
                {/* Admin Portal - Only show for admin users */}
                {user && (user.role === 'admin' || user.role === 'Admin') && (
                  <button
                    onClick={() => {
                      setLaunchParams(null);
                      setCurrentPortal('admin');
                    }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                      currentPortal === 'admin'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    Admin Portal
                  </button>
                )}
              </nav>
              
              {/* User Dropdown */}
              <div className="relative">
                <div className="relative user-dropdown">
                  <button
                    onClick={() => setShowUserDropdown(!showUserDropdown)}
                    className="flex items-center space-x-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-all duration-200"
                  >
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-full">
                      <User className="h-4 w-4 text-blue-600" />
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${showUserDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showUserDropdown && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <div className="font-semibold text-gray-900">{user.name}</div>
                        <div className="text-sm text-gray-500">{user.role}</div>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-red-700 hover:bg-red-50 flex items-center gap-2 transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        Logout
                      </button>
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