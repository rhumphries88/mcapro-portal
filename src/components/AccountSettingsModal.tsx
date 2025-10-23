import { useEffect, useState } from 'react';
import { Camera, X, User } from 'lucide-react';
import { getUserProfile, updateUserProfile, uploadUserAvatar } from '../lib/supabase';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  onSaved?: () => void | Promise<void>;
}

export default function AccountSettingsModal({ open, onClose, userId, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!open) return;
      setInitialLoading(true);
      setError(null);
      try {
        const user = await getUserProfile(userId);
        if (!mounted) return;
        setFullName(user.full_name || '');
        setEmail(user.email || '');
        setAvatarUrl(user.avatar_url ?? null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load profile';
        setError(msg);
      } finally {
        if (mounted) setInitialLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [open, userId]);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      let newAvatarUrl: string | undefined;
      if (file) {
        newAvatarUrl = await uploadUserAvatar(userId, file);
      }
      await updateUserProfile(userId, { full_name: fullName, ...(newAvatarUrl ? { avatar_url: newAvatarUrl } : {}) });
      setSuccess('Saved');
      if (onSaved) await onSaved();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl border-0 overflow-hidden">
        {/* Header with gradient */}
        <div className="relative bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-6 py-8">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-600/20"></div>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors backdrop-blur-sm"
          >
            <X className="h-5 w-5 text-white" />
          </button>
          <div className="relative text-center">
            <h2 className="text-2xl font-bold text-white mb-2">Profile Settings</h2>
            <p className="text-blue-100 text-sm">Manage your account information</p>
          </div>
        </div>

        <div className="px-6 py-6">
          {initialLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading profile...</span>
            </div>
          ) : (
            <>
              {/* Status Messages */}
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              {success && (
                <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-sm text-emerald-700">✓ {success}</p>
                </div>
              )}

              {/* Avatar Section */}
              <div className="flex flex-col items-center mb-8">
                <div className="relative group">
                  <div className="relative">
                    {avatarUrl ? (
                      <img 
                        src={avatarUrl} 
                        alt="Profile" 
                        className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-lg ring-4 ring-blue-100" 
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 border-4 border-white shadow-lg ring-4 ring-blue-100 flex items-center justify-center">
                        <User className="h-10 w-10 text-blue-600" />
                      </div>
                    )}
                    <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      <Camera className="h-6 w-6 text-white" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files && e.target.files[0];
                          if (f) {
                            setFile(f);
                            const url = URL.createObjectURL(f);
                            setAvatarUrl(url);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3 text-center">Click to change profile photo<br />PNG, JPG up to 2MB</p>
              </div>

              {/* Form Fields */}
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                  <div className="relative">
                    <input
                      type="email"
                      value={email}
                      readOnly
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-600 font-medium focus:outline-none cursor-not-allowed"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                      <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:outline-none transition-colors font-medium"
                    placeholder="Enter your full name"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <div className="flex gap-3">
            <button 
              onClick={onClose} 
              className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave} 
              disabled={loading || initialLoading}
              className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </div>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
