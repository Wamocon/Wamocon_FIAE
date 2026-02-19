'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, Lock, ShieldCheck } from 'lucide-react';
import { createPortal } from 'react-dom';
import HaiAdminWidget from './HaiAdminWidget';

interface HaiAdminDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function HaiAdminDialog({ open, onClose }: HaiAdminDialogProps) {
  const [pin, setPin] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setPin('');
      setError('');
      // Keep authenticated state for the session
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const verifyPin = useCallback(async () => {
    if (!pin.trim()) return;
    setVerifying(true);
    setError('');

    try {
      const res = await fetch('/api/hai/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      });

      if (res.ok) {
        setAuthenticated(true);
        setPin('');
      } else {
        setError('Falscher PIN. Bitte versuchen Sie es erneut.');
        setPin('');
      }
    } catch {
      setError('Verbindungsfehler. Bitte versuchen Sie es erneut.');
    } finally {
      setVerifying(false);
    }
  }, [pin]);

  if (!open || !mounted) return null;

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f1117] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-white text-lg font-bold flex items-center gap-2">
            <span className="text-xl">🦈</span>
            HAI Admin
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {!authenticated ? (
            /* PIN Entry Gate */
            <div className="flex flex-col items-center py-8 space-y-6">
              <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Lock className="w-8 h-8 text-cyan-400" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-white text-lg font-semibold">
                  Zugriff geschützt
                </h3>
                <p className="text-gray-400 text-sm max-w-xs">
                  Bitte geben Sie den Admin-PIN ein, um auf die
                  HAI-Verwaltung zuzugreifen.
                </p>
              </div>

              <div className="w-full max-w-xs space-y-3">
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') verifyPin();
                  }}
                  placeholder="Admin-PIN eingeben"
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-gray-500 text-center text-lg tracking-widest focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                  autoFocus
                  disabled={verifying}
                />

                {error && (
                  <p className="text-red-400 text-sm text-center">{error}</p>
                )}

                <button
                  onClick={verifyPin}
                  disabled={verifying || !pin.trim()}
                  className={`w-full px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                    verifying || !pin.trim()
                      ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-black'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {verifying ? 'Überprüfe...' : 'Zugriff bestätigen'}
                </button>
              </div>
            </div>
          ) : (
            /* Authenticated — show HAI Admin Widget */
            <HaiAdminWidget />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
