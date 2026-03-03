'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export type UINotification = {
  id: string;
  userId: string;
  actorId: string | null;
  type: string;
  title: string;
  message: string | null;
  linkUrl: string | null;
  context?: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export default function NotificationsBell() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UINotification[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const unread = useMemo(() => items.filter(i => !i.isRead).length, [items]);

  useEffect(() => {
    if (!profile?.id) return;
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/notifications?userId=${profile.id}&limit=30`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          if (mounted) setItems(data.notifications || []);
        }
      } finally {
        setLoading(false);
      }
    };
    load();

    // Realtime subscription for this user's notifications
    const channel = supabase
      .channel(`public:notifications:user=${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        payload => {
          try {
            if (!mounted) return;
            if (payload.eventType === 'INSERT') {
              const row = payload.new as any;
              setItems(prev =>
                [
                  {
                    id: row.id,
                    userId: row.user_id,
                    actorId: row.actor_id ?? null,
                    type: row.type,
                    title: row.title,
                    message: row.message ?? null,
                    linkUrl: row.link_url ?? null,
                    context: row.context ?? null,
                    isRead: Boolean(row.is_read),
                    readAt: row.read_at ?? null,
                    createdAt: row.created_at,
                  },
                  ...prev,
                ].slice(0, 50)
              );
            } else if (payload.eventType === 'UPDATE') {
              const row = payload.new as any;
              setItems(prev =>
                prev.map(i =>
                  i.id === row.id
                    ? {
                        ...i,
                        isRead: Boolean(row.is_read),
                        readAt: row.read_at ?? null,
                      }
                    : i
                )
              );
            }
          } catch {
            // ignore
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      try {
        channel.unsubscribe();
      } catch {}
    };
  }, [profile?.id]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const markAsRead = async (id: string) => {
    const prevItems = items;
    // Optimistic update
    setItems(prev =>
      prev.map(i =>
        i.id === id
          ? { ...i, isRead: true, readAt: new Date().toISOString() }
          : i
      )
    );
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      setItems(prevItems);
    }
  };

  const markAllAsRead = async () => {
    if (!profile?.id) return;
    const unreadItems = items.filter(i => !i.isRead);
    if (unreadItems.length === 0) return;
    // Optimistic update
    setItems(prev =>
      prev.map(i => ({
        ...i,
        isRead: true,
        readAt: i.readAt || new Date().toISOString(),
      }))
    );
    try {
      const res = await fetch(`/api/notifications/mark-all-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      // Revert on failure by re-fetching
      try {
        const res = await fetch(
          `/api/notifications?userId=${profile.id}&limit=30`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          setItems(data.notifications || []);
        }
      } catch {}
    }
  };

  const onItemClick = async (n: UINotification) => {
    try {
      if (!n.isRead) await markAsRead(n.id);
    } finally {
      if (n.linkUrl) router.push(n.linkUrl);
      setOpen(false);
    }
  };

  if (!profile) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="hover:bg-muted text-muted hover:text-foreground relative rounded-lg p-2"
        onClick={() => setOpen(o => !o)}
        aria-label={t('notifications.title')}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="bg-accent text-accent-foreground absolute -top-1 -right-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="bg-card border-border absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border shadow-xl">
          <div className="border-border bg-muted/40 flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">
              {t('notifications.title')}
            </span>
            {unread > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
                title={t('notifications.markAllRead')}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center p-4">
                <LoadingSpinner size="sm" />
              </div>
            )}
            {!loading && items.length === 0 && (
              <div className="text-muted-foreground p-4 text-center text-sm">
                {t('notifications.none')}
              </div>
            )}
            {(() => {
              const unreadItems = items.filter(i => !i.isRead);
              const readItems = items.filter(i => i.isRead);
              const visible = [...unreadItems, ...readItems.slice(0, 5)];

              return visible.map(n => (
                <button
                  key={n.id}
                  onClick={() => onItemClick(n)}
                  className={`border-border/30 hover:bg-muted w-full border-b px-4 py-3 text-left text-sm transition-colors ${n.isRead ? 'opacity-60' : 'bg-accent/10 font-medium'}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <span className="bg-accent mt-1.5 h-2 w-2 shrink-0 rounded-full" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground line-clamp-1">
                        {n.title}
                      </div>
                      {n.message && (
                        <div className="text-muted-foreground line-clamp-2 text-xs font-normal">
                          {n.message}
                        </div>
                      )}
                      <div className="text-muted-foreground mt-1 text-[10px] font-normal">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </button>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
