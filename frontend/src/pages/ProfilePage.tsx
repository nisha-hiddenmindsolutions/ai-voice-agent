import React, { useState } from 'react';
import { Loader2, Save, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';

const ProfilePage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await authApi.updateProfile({
        full_name: fullName.trim(),
        avatar_url: avatarUrl.trim(),
      });
      setUser(response.data);
      toast.success('Profile updated');
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error('Could not update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6 text-[var(--text-primary)]">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--primary)] text-white">
          <UserRound size={18} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Profile</h1>
          <p className="text-xs text-[var(--text-muted)] font-medium">
            Manage your workspace identity.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSave}
        className="border border-[var(--border)] rounded-lg bg-[var(--surface)] p-5 space-y-5"
      >
        <div className="grid gap-4 md:grid-cols-[96px_1fr] md:items-start">
          <div className="w-20 h-20 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-secondary)] flex items-center justify-center text-lg font-bold">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile avatar" className="w-full h-full object-cover" />
            ) : (
              (fullName || user?.email || 'U').slice(0, 1).toUpperCase()
            )}
          </div>

          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Full Name
              </span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Avatar URL
              </span>
              <input
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </label>

            <div className="text-xs text-[var(--text-muted)]">
              {user?.email}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[var(--primary)] text-white disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Profile
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProfilePage;
