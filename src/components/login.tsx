import React, { useState } from 'react';
import { Building2, Lock, Mail, UserPlus, LogIn, Shield, TrendingUp, Users, Eye, EyeOff, CheckCircle, Clock} from 'lucide-react';
import { registerUser, loginUser, supabase } from '../lib/supabase';
import Admin from './admin';

type LoginProps = {
  onRegistrationStart?: () => void;
  onRegistrationEnd?: () => void;
  showPendingApproval?: boolean;
  onClosePendingApproval?: () => void;
};

const Login: React.FC<LoginProps> = ({ onRegistrationStart, onRegistrationEnd, showPendingApproval, onClosePendingApproval }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showPendingApprovalPopup, setShowPendingApprovalPopup] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check for existing admin session on component mount
  React.useEffect(() => {
    const adminLoggedIn = localStorage.getItem('adminLoggedIn');
    if (adminLoggedIn === 'true') {
      setIsAdmin(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData(e.currentTarget);
      const email = formData.get('email') as string;
      const password = formData.get('password') as string;
      const fullName = formData.get('fullName') as string;
      const confirmPassword = formData.get('confirmPassword') as string;

      if (mode === 'register') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        
        // Signal registration start
        onRegistrationStart?.();
        
        await registerUser({
          email,
          password,
          fullName
        });
        
        // Signal registration end
        onRegistrationEnd?.();
        
        // Small delay to ensure auth state is updated before showing popup
        setTimeout(() => {
          setShowSuccessPopup(true);
        }, 100);
      } else {
        // Check admin table first
        console.log('Checking admin login for:', email, password);
        
        // First, check if admin exists by email
        const { data: adminCheck, error: adminCheckError } = await supabase
          .from('admin')
          .select('*')
          .eq('email', email)
          .single();
        
        console.log('Admin email check:', { adminCheck, adminCheckError });
        
        // If admin exists, check password
        if (!adminCheckError && adminCheck) {
          if (adminCheck.password === password) {
            console.log('Admin login successful');
            // Store admin session in localStorage for persistence
            localStorage.setItem('adminLoggedIn', 'true');
            setIsAdmin(true);
            return;
          } else {
            console.log('Admin password mismatch');
          }
        }

        // Check users table
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .single();

        if (!userError && userData) {
          // Verify password (assuming you have password field in users table)
          // For now, just check if user exists and proceed with regular login
          await loginUser({
            email,
            password
          });
          
          // User login successful - App.tsx will handle the routing through auth state
          return;
        }

        // If neither admin nor user found
        throw new Error('Invalid credentials');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      // End registration state on error
      if (mode === 'register') {
        onRegistrationEnd?.();
      }
    } finally {
      setLoading(false);
    }
  };

  // If admin is logged in, show admin UI
  if (isAdmin) {
    return <Admin onLogout={() => setIsAdmin(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm shadow-sm border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 py-6">
            <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl shadow-lg">
              <Building2 className="h-8 w-8 text-white" />
            </div>
            <div>
              <span className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                MCAPortal Pro
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12">
        <div className="w-full max-w-lg">
          {/* Welcome Section */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {mode === 'login' ? 'Welcome Back' : 'Join MCAPortal Pro'}
            </h1>
            <p className="text-gray-600">
              {mode === 'login' 
                ? 'Access your merchant cash advance dashboard' 
                : 'Create your account to get started with professional banking solutions'
              }
            </p>
          </div>

          {/* Main Card */}
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
            {/* Tab Header */}
            <div className="p-8 pb-6">
              <div className="flex rounded-2xl bg-gray-50/80 p-1.5 border border-gray-200/50">
                <button
                  onClick={() => setMode('login')}
                  className={`w-1/2 px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    mode === 'login' 
                      ? 'bg-white text-blue-700 shadow-md border border-blue-100' 
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </span>
                </button>
                <button
                  onClick={() => setMode('register')}
                  className={`w-1/2 px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    mode === 'register' 
                      ? 'bg-white text-emerald-700 shadow-md border border-emerald-100' 
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    Register
                  </span>
                </button>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-red-700 text-sm font-medium">{error}</p>
                </div>
              )}
              
              {mode === 'register' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                  <div className="relative">
                    <input
                      name="fullName"
                      type="text"
                      required
                      className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all bg-gray-50/50 text-gray-900 placeholder-gray-500"
                      placeholder="Enter your full name"
                    />
                    <Users className="h-5 w-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                <div className="relative">
                  <input
                    name="email"
                    type="email"
                    required
                    className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-gray-50/50 text-gray-900 placeholder-gray-500"
                    placeholder="Enter your email address"
                  />
                  <Mail className="h-5 w-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
                <div className="relative">
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    className="w-full pl-12 pr-12 py-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-gray-50/50 text-gray-900 placeholder-gray-500"
                    placeholder="Enter your password"
                  />
                  <Lock className="h-5 w-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Confirm Password</label>
                  <div className="relative">
                    <input
                      name="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      className="w-full pl-12 pr-12 py-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all bg-gray-50/50 text-gray-900 placeholder-gray-500"
                      placeholder="Confirm your password"
                    />
                    <Lock className="h-5 w-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-4 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg ${
                  mode === 'login' 
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/25' 
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-500/25'
                } ${loading ? 'opacity-70 cursor-not-allowed' : 'hover:shadow-xl transform hover:-translate-y-0.5'}`}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing...
                  </span>
                ) : (
                  mode === 'login' ? 'Sign In to Dashboard' : 'Create Your Account'
                )}
              </button>

              {mode === 'login' && (
                <div className="text-center">
                  <button type="button" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                    Forgot your password?
                  </button>
                </div>
              )}
            </form>

            {/* Footer */}
            <div className="px-8 pb-8">
              <div className="text-center text-sm text-gray-600 border-t border-gray-100 pt-6">
                {mode === 'login' ? (
                  <>
                    New to MCAPortal Pro?{' '}
                    <button
                      className="text-emerald-600 hover:text-emerald-700 font-semibold"
                      onClick={() => setMode('register')}
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      className="text-blue-600 hover:text-blue-700 font-semibold"
                      onClick={() => setMode('login')}
                    >
                      Sign in here
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Trust Indicators */}
          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
              <Shield className="h-6 w-6 text-blue-600 mx-auto mb-2" />
              <p className="text-xs font-medium text-gray-700">Bank-Level Security</p>
            </div>
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
              <TrendingUp className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
              <p className="text-xs font-medium text-gray-700">Fast Approvals</p>
            </div>
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
              <Users className="h-6 w-6 text-indigo-600 mx-auto mb-2" />
              <p className="text-xs font-medium text-gray-700">Trusted by 1000+</p>
            </div>
          </div>
        </div>
      </div>

      {/* Success Popup */}
      {showSuccessPopup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <CheckCircle className="h-8 w-8 text-white" />
              </div>
              
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Registration Successful!
              </h3>
              
              <p className="text-gray-600 mb-8 leading-relaxed">
                Your account has been created successfully. You can now sign in with your new credentials to access MCAPortal Pro.
              </p>
              
              <button
                onClick={() => {
                  setShowSuccessPopup(false);
                  setMode('login');
                  // Clear the form by resetting it after a small delay
                  setTimeout(() => {
                    const form = document.querySelector('form') as HTMLFormElement;
                    if (form) form.reset();
                  }, 100);
                }}
                className="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                Continue to Sign In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Approval Popup */}
      {(showPendingApprovalPopup || showPendingApproval) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <Clock className="h-8 w-8 text-white" />
              </div>
              
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Account Pending Approval
              </h3>
              
              <p className="text-gray-600 mb-8 leading-relaxed">
                Your account has been created successfully, but you need to wait for admin approval to set your role before you can access the main portal. Please contact your administrator or wait for approval.
              </p>
              
              <button
                onClick={() => {
                  setShowPendingApprovalPopup(false);
                  onClosePendingApproval?.();
                  // User is already signed out, just close the popup
                }}
                className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
