'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { User, Edit3, Award, Clock, Target, TrendingUp } from 'lucide-react';

export function Profile() {
  const { profile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState({
    full_name: profile?.full_name || '',
    email: profile?.email || '',
    role: profile?.role || 'trainee',
    training_start_date: profile?.training_start_date || '',
  });

  if (!profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground mt-4">Lade Profil...</p>
        </div>
      </div>
    );
  }

  const handleSave = () => {
    // Handle save logic here
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedProfile({
      full_name: profile.full_name || '',
      email: profile.email || '',
      role: profile.role || 'trainee',
      training_start_date: profile.training_start_date || '',
    });
    setIsEditing(false);
  };

  return (
    <div className="bg-background min-h-screen p-6">
      {/* Profile Header */}
      <div className="bg-card border-border rounded-3xl border p-8 shadow-lg">
        <div className="flex items-center space-x-6">
          <div className="from-primary to-primary/80 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br">
            <User className="text-primary-foreground h-10 w-10" />
          </div>
          <div className="flex-1">
            <h1 className="text-foreground text-3xl font-bold">
              {isEditing ? (
                <input
                  type="text"
                  value={editedProfile.full_name}
                  onChange={e =>
                    setEditedProfile({
                      ...editedProfile,
                      full_name: e.target.value,
                    })
                  }
                  className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-2 focus:border-transparent focus:ring-2 focus:outline-none"
                />
              ) : (
                profile.full_name
              )}
            </h1>
            <p className="text-muted-foreground text-lg">
              {profile.role === 'trainee' ? 'Auszubildender' : 'Ausbilder'}
            </p>
          </div>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="bg-accent/10 hover:bg-accent/20 rounded-xl p-3 transition-colors"
          >
            <Edit3 className="text-accent h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Personal Information */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-8 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          Persönliche Informationen
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              Vollständiger Name
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editedProfile.full_name}
                onChange={e =>
                  setEditedProfile({
                    ...editedProfile,
                    full_name: e.target.value,
                  })
                }
                className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
              />
            ) : (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                {profile.full_name}
              </div>
            )}
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              E-Mail
            </label>
            {isEditing ? (
              <input
                type="email"
                value={editedProfile.email}
                onChange={e =>
                  setEditedProfile({ ...editedProfile, email: e.target.value })
                }
                className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
              />
            ) : (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                {profile.email}
              </div>
            )}
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              Rolle
            </label>
            <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
              {profile.role === 'trainee' ? 'Auszubildender' : 'Ausbilder'}
            </div>
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              Ausbildungsstart
            </label>
            <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
              {profile.training_start_date || 'Nicht angegeben'}
            </div>
          </div>
        </div>

        {isEditing && (
          <div className="mt-6 flex space-x-4">
            <button
              onClick={handleSave}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-3 transition-colors duration-200"
            >
              Speichern
            </button>
            <button
              onClick={handleCancel}
              className="bg-muted text-muted-foreground hover:bg-muted/80 rounded-xl px-6 py-3 transition-colors duration-200"
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">Statistiken</h2>
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <div className="text-center">
            <Award className="text-accent mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">
              Module abgeschlossen
            </p>
            <p className="text-foreground text-2xl font-bold">12</p>
          </div>
          <div className="text-center">
            <Target className="text-primary mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">Zertifikate</p>
            <p className="text-foreground text-2xl font-bold">8</p>
          </div>
          <div className="text-center">
            <Clock className="text-accent mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">Lernstunden</p>
            <p className="text-foreground text-2xl font-bold">156</p>
          </div>
          <div className="text-center">
            <TrendingUp className="text-primary mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">Ziel erreicht</p>
            <p className="text-foreground text-2xl font-bold">85%</p>
          </div>
        </div>
      </div>

      {/* Recent Activities */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          Letzte Aktivitäten
        </h2>
        <div className="space-y-4">
          <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
            <span className="text-muted-foreground">
              Modul "JavaScript Grundlagen" abgeschlossen
            </span>
            <span className="text-muted-foreground ml-auto text-sm">
              vor 2 Stunden
            </span>
          </div>
          <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
            <span className="text-muted-foreground">
              Quiz "HTML & CSS" bestanden
            </span>
            <span className="text-muted-foreground ml-auto text-sm">
              vor 1 Tag
            </span>
          </div>
          <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
            <span className="text-muted-foreground">Reflexion eingereicht</span>
            <span className="text-muted-foreground ml-auto text-sm">
              vor 3 Tagen
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
