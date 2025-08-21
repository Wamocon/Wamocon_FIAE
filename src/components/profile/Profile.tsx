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
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="mt-4 text-muted-foreground">Lade Profil...</p>
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
    <div className="min-h-screen bg-background p-6">
      {/* Profile Header */}
      <div className="bg-card rounded-3xl p-8 shadow-lg border border-border">
        <div className="flex items-center space-x-6">
          <div className="w-20 h-20 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center">
            <User className="w-10 h-10 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">
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
                  className="w-full bg-muted border border-border rounded-xl px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
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
            className="p-3 bg-accent/10 hover:bg-accent/20 rounded-xl transition-colors"
          >
            <Edit3 className="w-5 h-5 text-accent" />
          </button>
        </div>
      </div>

      {/* Personal Information */}
      <div className="bg-card rounded-3xl p-8 shadow-lg border border-border mt-6">
        <h2 className="text-2xl font-bold text-foreground mb-6">
          Persönliche Informationen
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
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
                className="w-full bg-muted border border-border rounded-2xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
            ) : (
              <div className="px-4 py-3 bg-muted border border-border rounded-2xl text-foreground">
                {profile.full_name}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              E-Mail
            </label>
            {isEditing ? (
              <input
                type="email"
                value={editedProfile.email}
                onChange={e =>
                  setEditedProfile({ ...editedProfile, email: e.target.value })
                }
                className="w-full bg-muted border border-border rounded-2xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
            ) : (
              <div className="px-4 py-3 bg-muted border border-border rounded-2xl text-foreground">
                {profile.email}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Rolle
            </label>
            <div className="px-4 py-3 bg-muted border border-border rounded-2xl text-foreground">
              {profile.role === 'trainee' ? 'Auszubildender' : 'Ausbilder'}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Ausbildungsstart
            </label>
            <div className="px-4 py-3 bg-muted border border-border rounded-2xl text-foreground">
              {profile.training_start_date || 'Nicht angegeben'}
            </div>
          </div>
        </div>

        {isEditing && (
          <div className="flex space-x-4 mt-6">
            <button
              onClick={handleSave}
              className="px-6 py-3 bg-accent text-accent-foreground rounded-xl hover:bg-accent/90 transition-colors duration-200"
            >
              Speichern
            </button>
            <button
              onClick={handleCancel}
              className="px-6 py-3 bg-muted text-muted-foreground rounded-xl hover:bg-muted/80 transition-colors duration-200"
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="bg-card rounded-3xl p-6 shadow-lg border border-border mt-6">
        <h2 className="text-2xl font-bold text-foreground mb-6">Statistiken</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <Award className="w-8 h-8 text-accent mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Module abgeschlossen
            </p>
            <p className="text-2xl font-bold text-foreground">12</p>
          </div>
          <div className="text-center">
            <Target className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Zertifikate</p>
            <p className="text-2xl font-bold text-foreground">8</p>
          </div>
          <div className="text-center">
            <Clock className="w-8 h-8 text-accent mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Lernstunden</p>
            <p className="text-2xl font-bold text-foreground">156</p>
          </div>
          <div className="text-center">
            <TrendingUp className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Ziel erreicht</p>
            <p className="text-2xl font-bold text-foreground">85%</p>
          </div>
        </div>
      </div>

      {/* Recent Activities */}
      <div className="bg-card rounded-3xl p-6 shadow-lg border border-border mt-6">
        <h2 className="text-2xl font-bold text-foreground mb-6">
          Letzte Aktivitäten
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
            <span className="text-muted-foreground">
              Modul "JavaScript Grundlagen" abgeschlossen
            </span>
            <span className="text-muted-foreground text-sm ml-auto">
              vor 2 Stunden
            </span>
          </div>
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
            <span className="text-muted-foreground">
              Quiz "HTML & CSS" bestanden
            </span>
            <span className="text-muted-foreground text-sm ml-auto">
              vor 1 Tag
            </span>
          </div>
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
            <span className="text-muted-foreground">Reflexion eingereicht</span>
            <span className="text-muted-foreground text-sm ml-auto">
              vor 3 Tagen
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
