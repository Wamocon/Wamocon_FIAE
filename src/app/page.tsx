'use client';

import { useEffect, useState, useRef, useMemo, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/lib/supabase';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  BookOpen,
  ArrowRight,
  Eye,
  CheckCircle,
  X,
  Zap,
  Users,
  FileText,
  MessageSquare,
  Shield,
  Calendar,
  Brain,
  Star,
  Building2,
  ChevronDown,
  Send,
  Loader2,
  GraduationCap,
  TrendingUp,
  Award,
  Menu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { motion, useInView, AnimatePresence } from 'framer-motion';

// ─── Types ──────────────────────────────────────────────────────────────────────
type PlanId = 'Light' | 'Pro' | 'Enterprise';

interface ContactForm {
  name: string;
  company: string;
  email: string;
  phone: string;
  plan: PlanId | '';
  message: string;
}

// ─── Animation helpers ──────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};

// ─── Section wrapper with scroll-triggered reveal ───────────────────────────────
function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 28 }}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── FAQ Item ───────────────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`border-border border-b transition-colors last:border-0 ${open ? 'bg-red-500/2' : ''}`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-4 px-1 py-5 text-left"
      >
        <span className="mt-0.5 min-w-6.5 text-xs font-bold tracking-wider text-red-500 opacity-80">
          {open ? '−' : '+'}
        </span>
        <span className="text-foreground flex-1 font-semibold">{q}</span>
        <ChevronDown
          className={`text-muted-foreground mt-0.5 h-4 w-4 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <p className="text-muted-foreground pr-1 pb-5 pl-10 text-sm leading-relaxed">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Pricing Modal ───────────────────────────────────────────────────────────────
function PricingModal({
  plan,
  onClose,
}: {
  plan: PlanId;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<ContactForm>({
    name: '',
    company: '',
    email: '',
    phone: '',
    plan,
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const planColors: Record<PlanId, string> = {
    Light: 'from-slate-500 to-slate-700',
    Pro: 'from-amber-500 to-amber-700',
    Enterprise: 'from-red-600 to-red-800',
  };

  const planBadge: Record<PlanId, { bg: string; text: string }> = {
    Light: { bg: 'bg-slate-100 text-slate-700', text: 'Light' },
    Pro: {
      bg: 'bg-amber-100 text-amber-800',
      text: `Pro – ${t('landing.modal.recommended')}`,
    },
    Enterprise: { bg: 'bg-red-100 text-red-800', text: 'Enterprise' },
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim()) {
      setError(t('landing.modal.requiredError'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('landing.modal.genericError'));
      } else {
        setSuccess(true);
      }
    } catch {
      setError(t('landing.modal.connectionError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-200 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />
      {/* Modal */}
      <motion.div
        className="bg-background border-border relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl"
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 20 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="bg-muted text-muted-foreground hover:bg-muted/80 absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {success ? (
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-foreground text-xl font-bold">
              {t('landing.modal.successTitle')}
            </h3>
            <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
              {t('landing.modal.successText1')} <strong>{plan}</strong>
              {t('landing.modal.successText2')}
            </p>
            <Button
              onClick={onClose}
              className="mt-2 bg-red-600 text-white hover:bg-red-700"
            >
              {t('landing.modal.close')}
            </Button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className={`bg-linear-to-r ${planColors[plan]} p-6`}>
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-bold tracking-wider ${planBadge[plan].bg} mb-3`}
              >
                {planBadge[plan].text}
              </span>
              <h2 className="text-xl font-bold text-white">
                {t('landing.modal.heading')}
              </h2>
              <p className="mt-1 text-sm text-white/80">
                {t('landing.modal.headingSub')}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-foreground mb-1.5 block text-xs font-semibold">
                    {t('landing.modal.name')}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={e =>
                      setForm(f => ({ ...f, name: e.target.value }))
                    }
                    placeholder={t('landing.modal.namePlaceholder')}
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-foreground mb-1.5 block text-xs font-semibold">
                    {t('landing.modal.company')}
                  </label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={e =>
                      setForm(f => ({ ...f, company: e.target.value }))
                    }
                    placeholder={t('landing.modal.companyPlaceholder')}
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-foreground mb-1.5 block text-xs font-semibold">
                    {t('landing.modal.email')}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={e =>
                      setForm(f => ({ ...f, email: e.target.value }))
                    }
                    placeholder={t('landing.modal.emailPlaceholder')}
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-foreground mb-1.5 block text-xs font-semibold">
                    {t('landing.modal.phone')}
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e =>
                      setForm(f => ({ ...f, phone: e.target.value }))
                    }
                    placeholder={t('landing.modal.phonePlaceholder')}
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-foreground mb-1.5 block text-xs font-semibold">
                  {t('landing.modal.plan')}
                </label>
                <select
                  value={form.plan}
                  onChange={e =>
                    setForm(f => ({ ...f, plan: e.target.value as PlanId }))
                  }
                  className="border-border bg-background text-foreground w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                >
                  <option value="Light">Light</option>
                  <option value="Pro">Pro</option>
                  <option value="Enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="text-foreground mb-1.5 block text-xs font-semibold">
                  {t('landing.modal.message')}
                </label>
                <textarea
                  rows={3}
                  value={form.message}
                  onChange={e =>
                    setForm(f => ({ ...f, message: e.target.value }))
                  }
                  placeholder={t('landing.modal.messagePlaceholder')}
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full resize-none rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                />
              </div>
              {error && (
                <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('landing.modal.sending')}
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    {t('landing.modal.submit')}
                  </>
                )}
              </Button>
              <p className="text-muted-foreground text-center text-xs">
                {t('landing.modal.privacy')}
              </p>
            </form>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Landing Page
// ═══════════════════════════════════════════════════════════════════════════════

// ─── FIAE Lernfelder Data ─────────────────────────────────────────────────────
const LF_DATA = [
  {
    id: 1,
    short: 'LF1',
    nameKey: 'landing.lf.lf1',
    komps: 4,
    uc: 9,
  },
  {
    id: 2,
    short: 'LF2',
    nameKey: 'landing.lf.lf2',
    komps: 7,
    uc: 20,
  },
  {
    id: 3,
    short: 'LF3',
    nameKey: 'landing.lf.lf3',
    komps: 9,
    uc: 14,
  },
  {
    id: 4,
    short: 'LF4',
    nameKey: 'landing.lf.lf4',
    komps: 5,
    uc: 8,
  },
  {
    id: 5,
    short: 'LF5',
    nameKey: 'landing.lf.lf5',
    komps: 13,
    uc: 20,
  },
  { id: 6, short: 'LF6', nameKey: 'landing.lf.lf6', komps: 8, uc: 12 },
  {
    id: 7,
    short: 'LF7',
    nameKey: 'landing.lf.lf7',
    komps: 5,
    uc: 8,
  },
  {
    id: 8,
    short: 'LF8',
    nameKey: 'landing.lf.lf8',
    komps: 14,
    uc: 22,
  },
  {
    id: 9,
    short: 'LF9',
    nameKey: 'landing.lf.lf9',
    komps: 9,
    uc: 17,
  },
  {
    id: 10,
    short: 'LF10',
    nameKey: 'landing.lf.lf10',
    komps: 6,
    uc: 11,
  },
  {
    id: 11,
    short: 'LF11',
    nameKey: 'landing.lf.lf11',
    komps: 10,
    uc: 16,
  },
  {
    id: 12,
    short: 'LF12',
    nameKey: 'landing.lf.lf12',
    komps: 12,
    uc: 22,
  },
];

// ─── Interactive Solar System Canvas ─────────────────────────────────────────
function SolarSystemCanvas() {
  const { t } = useLanguage();
  const canRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{
    text: string;
    sub: string;
    x: number;
    y: number;
  } | null>(null);
  const [mode, setMode] = useState<'solar' | 'lf'>('solar');

  const stRef = useRef<{
    W: number;
    H: number;
    cx: number;
    cy: number;
    sc: number;
    raf: number;
    stars: {
      x: number;
      y: number;
      r: number;
      ph: number;
      sp: number;
      col: string;
    }[];
    comets: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      len: number;
      alpha: number;
      life: number;
    }[];
    nextComet: number;
    planets: {
      abbr: string;
      orbitR0: number;
      r0: number;
      speed: number;
      angle: number;
      active: boolean;
      _sx: number;
      _sy: number;
    }[];
    lfs: {
      id: number;
      short: string;
      nameKey: string;
      komps: number;
      uc: number;
      orbitR0: number;
      r0: number;
      speed: number;
      angle: number;
      _sx: number;
      _sy: number;
    }[];
    hovered: string | null;
    modeStr: 'solar' | 'lf';
  }>({
    W: 0,
    H: 0,
    cx: 0,
    cy: 0,
    sc: 1,
    raf: 0,
    stars: [],
    comets: [],
    nextComet: 0,
    planets: [
      {
        abbr: 'FIAE',
        orbitR0: 120,
        r0: 26,
        speed: 0.00035,
        angle: Math.PI * 0.25,
        active: true,
        _sx: 0,
        _sy: 0,
      },
      {
        abbr: 'FISI',
        orbitR0: 200,
        r0: 22,
        speed: 0.00022,
        angle: Math.PI * 1.6,
        active: false,
        _sx: 0,
        _sy: 0,
      },
      {
        abbr: 'IT-Kfm',
        orbitR0: 270,
        r0: 20,
        speed: 0.00016,
        angle: Math.PI * 0.9,
        active: false,
        _sx: 0,
        _sy: 0,
      },
      {
        abbr: 'IT-Sys',
        orbitR0: 340,
        r0: 20,
        speed: 0.00011,
        angle: Math.PI * 2.4,
        active: false,
        _sx: 0,
        _sy: 0,
      },
    ],
    lfs: LF_DATA.map((lf, i) => {
      const ring = Math.floor(i / 4);
      return {
        ...lf,
        orbitR0: 90 + ring * 95, // rings at 90 / 185 / 280
        r0: 13,
        speed: 0.00025 - ring * 0.00004,
        angle: ((Math.PI * 2) / 4) * (i % 4) + ring * 0.5 + 0.3,
        _sx: 0,
        _sy: 0,
      };
    }),
    hovered: null,
    modeStr: 'solar',
  });

  useEffect(() => {
    if (!canRef.current) return;
    const canvas: HTMLCanvasElement = canRef.current;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const st = stRef.current;

    function genStars() {
      const cols = [
        '#ffffff',
        '#ffffff',
        '#ddeeff',
        '#ffeedd',
        '#eeeeff',
        '#ffddee',
      ];
      st.stars = Array.from({ length: 240 }, () => ({
        x: Math.random() * st.W,
        y: Math.random() * st.H,
        r: Math.random() * 1.1 + 0.1,
        ph: Math.random() * 6.2832,
        sp: Math.random() * 0.5 + 0.15,
        col: cols[Math.floor(Math.random() * cols.length)],
      }));
    }

    function resize() {
      const parent = canvas.parentElement;
      if (!parent) return;
      st.W = canvas.width = parent.offsetWidth;
      st.H = canvas.height = parent.offsetHeight;
      st.cx = st.W / 2;
      st.cy = st.H / 2;
      st.sc = Math.min(1, Math.min(st.W, st.H * 1.5) / 800);
      genStars();
    }

    function drawSun(ts: number) {
      const { cx, cy, sc } = st;
      const pulse = 0.5 + 0.5 * Math.sin(ts * 0.0012);
      // outer haze
      let g: CanvasGradient = ctx.createRadialGradient(
        cx,
        cy,
        0,
        cx,
        cy,
        200 * sc
      );
      g.addColorStop(0, 'rgba(255,100,0,.14)');
      g.addColorStop(0.5, 'rgba(220,40,0,.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 200 * sc, 0, 6.2832);
      ctx.fill();
      // corona
      const cr = (110 + pulse * 15) * sc;
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      g.addColorStop(0, 'rgba(255,180,30,.9)');
      g.addColorStop(0.25, 'rgba(255,100,10,.55)');
      g.addColorStop(0.6, 'rgba(200,30,0,.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, 6.2832);
      ctx.fill();
      // core
      const coreR = 48 * sc;
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      g.addColorStop(0, '#ffeeaa');
      g.addColorStop(0.3, '#ffb830');
      g.addColorStop(0.65, '#e05500');
      g.addColorStop(0.88, '#a01800');
      g.addColorStop(1, '#3a0500');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, 6.2832);
      ctx.fill();
      // label
      ctx.font = `bold ${Math.max(11, Math.round(14 * sc))}px Inter,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.fillText('LFA', cx, cy);
      ctx.shadowBlur = 0;
    }

    function frame(ts: number) {
      ctx.clearRect(0, 0, st.W, st.H);
      const isLight = document.documentElement.classList.contains('light');

      // ── Twinkling stars ── (always bright on black background)
      for (const s of st.stars) {
        ctx.globalAlpha =
          0.1 + 0.5 * (0.5 + 0.5 * Math.sin(ts * 0.001 * s.sp + s.ph));
        ctx.fillStyle = s.col;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Shooting comets ──
      if (st.nextComet === 0) st.nextComet = ts + 3000;
      if (ts > st.nextComet) {
        st.nextComet = ts + 5000 + Math.random() * 10000;
        const ang = Math.random() * 0.6 + 0.1;
        st.comets.push({
          x: Math.random() * st.W * 0.7,
          y: Math.random() * st.H * 0.25,
          vx: Math.cos(ang) * 4,
          vy: Math.sin(ang) * 4,
          len: 70 + Math.random() * 80,
          alpha: 0.8,
          life: 1,
        });
      }
      for (let i = st.comets.length - 1; i >= 0; i--) {
        const c = st.comets[i];
        c.x += c.vx;
        c.y += c.vy;
        c.life -= 0.006;
        if (c.life <= 0) {
          st.comets.splice(i, 1);
          continue;
        }
        const d = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 1;
        const cg: CanvasGradient = ctx.createLinearGradient(
          c.x,
          c.y,
          c.x - (c.vx / d) * c.len,
          c.y - (c.vy / d) * c.len
        );
        cg.addColorStop(0, `rgba(220,220,255,${c.alpha * c.life})`);
        cg.addColorStop(1, 'rgba(220,220,255,0)');
        ctx.strokeStyle = cg;
        ctx.lineWidth = Math.max(0.5, 1.5 * c.life);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x - (c.vx / d) * c.len, c.y - (c.vy / d) * c.len);
        ctx.stroke();
      }

      // ── Solar mode ──
      if (st.modeStr === 'solar') {
        // Nebula atmosphere
        const neb: CanvasGradient = ctx.createRadialGradient(
          st.cx,
          st.cy,
          0,
          st.cx,
          st.cy,
          st.sc * 380
        );
        neb.addColorStop(0, 'rgba(180,20,0,.07)');
        neb.addColorStop(0.5, 'rgba(80,0,40,.03)');
        neb.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = neb;
        ctx.beginPath();
        ctx.arc(st.cx, st.cy, st.sc * 380, 0, 6.2832);
        ctx.fill();
        drawSun(ts);

        for (const p of st.planets) {
          p.angle += p.speed * 16;
          const pr = p.r0 * st.sc;
          const r = Math.min(
            p.orbitR0 * st.sc,
            Math.min(st.cx, st.cy) - pr - 10
          );
          const px = st.cx + Math.cos(p.angle) * r;
          const py = st.cy + Math.sin(p.angle) * r;
          p._sx = px;
          p._sy = py;

          // orbit ring
          ctx.strokeStyle = p.active
            ? 'rgba(255,80,80,.18)'
            : isLight
              ? 'rgba(80,90,120,.14)'
              : 'rgba(255,255,255,.05)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 7]);
          ctx.beginPath();
          ctx.arc(st.cx, st.cy, r, 0, 6.2832);
          ctx.stroke();
          ctx.setLineDash([]);

          if (p.active) {
            const pulse = 0.5 + 0.5 * Math.sin(ts * 0.0028);
            let pg: CanvasGradient = ctx.createRadialGradient(
              px,
              py,
              0,
              px,
              py,
              pr * 3.5
            );
            pg.addColorStop(0, `rgba(255,60,60,${0.4 + pulse * 0.3})`);
            pg.addColorStop(1, 'rgba(255,0,0,0)');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.arc(px, py, pr * 3.5, 0, 6.2832);
            ctx.fill();
            ctx.strokeStyle = `rgba(255,80,80,${0.2 + pulse * 0.6})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, pr + (3 + pulse * 6) * st.sc, 0, 6.2832);
            ctx.stroke();
            pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
            pg.addColorStop(0, '#d02020');
            pg.addColorStop(0.6, '#800000');
            pg.addColorStop(1, '#200000');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, 6.2832);
            ctx.fill();
            const rim: CanvasGradient = ctx.createRadialGradient(
              px - pr * 0.4,
              py - pr * 0.4,
              0,
              px,
              py,
              pr
            );
            rim.addColorStop(0, 'rgba(255,160,80,.3)');
            rim.addColorStop(1, 'rgba(255,160,80,0)');
            ctx.fillStyle = rim;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, 6.2832);
            ctx.fill();
          } else {
            const pg: CanvasGradient = ctx.createRadialGradient(
              px,
              py,
              0,
              px,
              py,
              pr
            );
            pg.addColorStop(0, isLight ? '#8d94a8' : '#555566');
            pg.addColorStop(0.7, isLight ? '#60687d' : '#2a2a3a');
            pg.addColorStop(1, isLight ? '#383f52' : '#0a0a14');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, 6.2832);
            ctx.fill();
          }
          const isHov = st.hovered === p.abbr;
          ctx.font = `bold ${Math.max(9, Math.round(11 * st.sc))}px Inter,sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,.8)';
          ctx.shadowBlur = 4;
          ctx.fillStyle = p.active
            ? isHov
              ? '#fff'
              : 'rgba(255,255,255,.95)'
            : 'rgba(255,255,255,.78)';
          ctx.fillText(p.abbr, px, py);
          ctx.shadowBlur = 0;
          if (p.active && isHov) {
            ctx.font = `${Math.max(7, Math.round(9 * st.sc))}px Inter,sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,.88)';
            ctx.fillText('Klicken →', px, py + pr + 14 * st.sc);
          }
        }
      } else {
        // ── Lernfelder mode: FIAE as center ──
        const fp = 0.5 + 0.5 * Math.sin(ts * 0.0018);
        const fiaR = (36 + fp * 4) * st.sc;
        let fg: CanvasGradient = ctx.createRadialGradient(
          st.cx,
          st.cy,
          0,
          st.cx,
          st.cy,
          fiaR * 4.5
        );
        fg.addColorStop(0, 'rgba(220,40,40,.55)');
        fg.addColorStop(0.4, 'rgba(160,15,15,.2)');
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(st.cx, st.cy, fiaR * 4.5, 0, 6.2832);
        ctx.fill();
        fg = ctx.createRadialGradient(st.cx, st.cy, 0, st.cx, st.cy, fiaR);
        fg.addColorStop(0, '#ff4444');
        fg.addColorStop(0.4, '#cc1010');
        fg.addColorStop(0.8, '#880000');
        fg.addColorStop(1, '#330000');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(st.cx, st.cy, fiaR, 0, 6.2832);
        ctx.fill();
        ctx.font = `bold ${Math.max(11, Math.round(13 * st.sc))}px Inter,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,.8)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#fff';
        ctx.fillText('FIAE', st.cx, st.cy);
        ctx.shadowBlur = 0;

        for (const lf of st.lfs) {
          lf.angle += lf.speed * 16;
          const pr = lf.r0 * st.sc;
          const r = Math.min(
            lf.orbitR0 * st.sc,
            Math.min(st.cx, st.cy) - pr - 8
          );
          const px = st.cx + Math.cos(lf.angle) * r;
          const py = st.cy + Math.sin(lf.angle) * r;
          lf._sx = px;
          lf._sy = py;
          const isHov = st.hovered === lf.short;

          const ucR = pr * 2.0; // inner ring: use cases
          const kpR = pr * 3.1; // outer ring: komponenten

          // Main LF orbit ring (faint, around FIAE centre)
          ctx.strokeStyle = isLight
            ? 'rgba(255,80,80,.14)'
            : 'rgba(255,80,80,.07)';
          ctx.lineWidth = 0.5;
          ctx.setLineDash([2, 8]);
          ctx.beginPath();
          ctx.arc(st.cx, st.cy, r, 0, 6.2832);
          ctx.stroke();
          ctx.setLineDash([]);

          // Sub-orbit ring circles (move WITH the LF planet)
          ctx.lineWidth = 0.5;
          ctx.setLineDash([1, 4]);
          ctx.strokeStyle = isLight
            ? 'rgba(56,189,248,.36)'
            : 'rgba(56,189,248,.20)'; // UC ring — sky blue
          ctx.beginPath();
          ctx.arc(px, py, ucR, 0, 6.2832);
          ctx.stroke();
          ctx.strokeStyle = isLight
            ? 'rgba(120,130,150,.28)'
            : 'rgba(226,232,240,.13)'; // Komp ring — slate
          ctx.beginPath();
          ctx.arc(px, py, kpR, 0, 6.2832);
          ctx.stroke();
          ctx.setLineDash([]);

          // hover glow
          if (isHov) {
            const hg: CanvasGradient = ctx.createRadialGradient(
              px,
              py,
              0,
              px,
              py,
              pr * 3.2
            );
            hg.addColorStop(0, 'rgba(255,100,100,.45)');
            hg.addColorStop(1, 'rgba(255,0,0,0)');
            ctx.fillStyle = hg;
            ctx.beginPath();
            ctx.arc(px, py, pr * 3.2, 0, 6.2832);
            ctx.fill();
          }

          // LF body
          const lgr: CanvasGradient = ctx.createRadialGradient(
            px,
            py,
            0,
            px,
            py,
            pr
          );
          lgr.addColorStop(0, isHov ? '#ff6666' : '#d02020');
          lgr.addColorStop(0.6, isHov ? '#992222' : '#700808');
          lgr.addColorStop(1, '#1a0000');
          ctx.fillStyle = lgr;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, 6.2832);
          ctx.fill();

          // LF label
          ctx.font = `bold ${Math.max(7, Math.round(9 * st.sc))}px Inter,sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,.9)';
          ctx.shadowBlur = 4;
          ctx.fillStyle = isHov ? '#fff' : 'rgba(255,255,255,.9)';
          ctx.fillText(lf.short, px, py);
          ctx.shadowBlur = 0;

          // ── Use Case dots (inner ring, sky-blue) ──
          for (let u = 0; u < lf.uc; u++) {
            const uAngle = ((Math.PI * 2) / lf.uc) * u + ts * 0.0015;
            const ux = px + Math.cos(uAngle) * ucR;
            const uy = py + Math.sin(uAngle) * ucR;
            ctx.globalAlpha = 0.75;
            ctx.fillStyle = isLight ? '#0ea5e9' : '#38bdf8';
            ctx.beginPath();
            ctx.arc(ux, uy, Math.max(1.5, 2.0 * st.sc), 0, 6.2832);
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          // ── Komponente dots (outer ring, slate-white) ──
          for (let k = 0; k < lf.komps; k++) {
            const kAngle = ((Math.PI * 2) / lf.komps) * k + ts * 0.0006;
            const kx = px + Math.cos(kAngle) * kpR;
            const ky = py + Math.sin(kAngle) * kpR;
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = isLight ? '#6b7280' : '#e2e8f0';
            ctx.beginPath();
            ctx.arc(kx, ky, Math.max(1.8, 2.5 * st.sc), 0, 6.2832);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }

      st.raf = requestAnimationFrame(frame);
    }

    function onMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let found: {
        abbr: string;
        name: string;
        sub: string;
        sx: number;
        sy: number;
      } | null = null;

      if (st.modeStr === 'solar') {
        for (const p of st.planets) {
          const dx = mx - p._sx;
          const dy = my - p._sy;
          if (Math.sqrt(dx * dx + dy * dy) < p.r0 * st.sc + 12) {
            found = {
              abbr: p.abbr,
              name: p.active
                ? 'FIAE – Fachinformatiker Anwendungsentwicklung'
                : p.abbr === 'FISI'
                  ? 'FISI – Systemintegration'
                  : p.abbr === 'IT-Kfm'
                    ? 'IT-Kaufmann/-frau'
                    : 'IT-Systemelektroniker/-in',
              sub: p.active
                ? '✦ Klicken zum Erkunden der 12 Lernfelder'
                : 'Bald verfügbar',
              sx: p._sx,
              sy: p._sy,
            };
            break;
          }
        }
      } else {
        for (const lf of st.lfs) {
          const dx = mx - lf._sx;
          const dy = my - lf._sy;
          if (Math.sqrt(dx * dx + dy * dy) < lf.r0 * st.sc + 8) {
            found = {
              abbr: lf.short,
              name: `${lf.short} – ${t(lf.nameKey)}`,
              sub: `${lf.komps} Komponenten · ${lf.uc} Use Cases`,
              sx: lf._sx,
              sy: lf._sy,
            };
            break;
          }
        }
      }

      st.hovered = found ? found.abbr : null;
      canvas.style.cursor = found ? 'pointer' : 'default';
      if (found)
        setTip({ text: found.name, sub: found.sub, x: found.sx, y: found.sy });
      else setTip(null);
    }

    function onClick(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (st.modeStr === 'solar') {
        const fiae = st.planets[0];
        const dx = mx - fiae._sx;
        const dy = my - fiae._sy;
        if (Math.sqrt(dx * dx + dy * dy) < fiae.r0 * st.sc + 14) {
          st.modeStr = 'lf';
          setMode('lf');
          st.hovered = null;
          setTip(null);
        }
      }
    }

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    st.raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(st.raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full" style={{ height: '720px' }}>
      <canvas
        ref={canRef}
        className="absolute inset-0 block h-full w-full"
        style={{ touchAction: 'pan-y' }}
      />

      {mode === 'lf' && (
        <button
          onClick={() => {
            stRef.current.modeStr = 'solar';
            setMode('solar');
            setTip(null);
            stRef.current.hovered = null;
          }}
          className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full border border-white/30 bg-black/65 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          ← Zurück zum Universum
        </button>
      )}

      {mode === 'solar' && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/25 bg-black/60 px-4 py-1.5 text-xs whitespace-nowrap text-white/85 backdrop-blur-sm">
          Klicke auf <span className="font-medium text-white">FIAE</span> ·
          Erkunde die 12 Lernfelder
        </div>
      )}

      {tip && (
        <div
          className="pointer-events-none absolute z-20 rounded-xl border border-white/20 bg-black/80 px-3.5 py-2.5 shadow-2xl backdrop-blur-md"
          style={{
            left: Math.min(
              tip.x + 18,
              (canRef.current?.offsetWidth ?? 600) - 220
            ),
            top: Math.max(tip.y - 60, 8),
            maxWidth: '215px',
          }}
        >
          <p className="text-sm font-semibold text-white">{tip.text}</p>
          <p className="mt-0.5 text-xs text-white/80">{tip.sub}</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Landing Page
// ═══════════════════════════════════════════════════════════════════════════════
export default function LandingPage() {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [activePlan, setActivePlan] = useState<PlanId | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setHasSession(!!data.session?.user);
        setSessionReady(true);
      })
      .catch(() => {
        if (!active) return;
        setHasSession(false);
        setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loading && sessionReady && hasSession && user && profile) {
      if (profile.role === 'trainee') router.push('/trainee/dashboard');
      else router.push('/trainer/dashboard');
    }
  }, [user, profile, loading, sessionReady, hasSession, router]);

  const shouldRedirect =
    !loading && sessionReady && hasSession && !!user && !!profile;

  const navLinks = useMemo(
    () => [
      { href: '#hero', label: t('landing.nav.home') },
      { href: '#warum-lfa', label: t('landing.nav.warumLfa') },
      { href: '#rollen', label: t('landing.nav.rollen') },
      { href: '#funktionen', label: t('landing.nav.funktionen') },
      { href: '#universum', label: t('landing.nav.universum') },
      { href: '#preise', label: t('landing.nav.preise') },
      { href: '#faq', label: t('landing.nav.faq') },
    ],
    [t]
  );

  useEffect(() => {
    const sectionIds = navLinks.map(link => link.href.slice(1));
    const sections = sectionIds
      .map(id => document.getElementById(id))
      .filter((section): section is HTMLElement => !!section);

    if (!sections.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      entries => {
        let mostVisible = entries[0];
        for (const entry of entries) {
          if (entry.intersectionRatio > mostVisible.intersectionRatio) {
            mostVisible = entry;
          }
        }

        if (mostVisible.isIntersecting) {
          setActiveSection(mostVisible.target.id);
        }
      },
      {
        root: null,
        rootMargin: '-30% 0px -55% 0px',
        threshold: [0.1, 0.25, 0.4, 0.6, 0.8],
      }
    );

    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [navLinks]);

  if (loading || shouldRedirect) {
    return (
      <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-red-900/30 via-red-800/25 to-red-900/35" />
        <div className="relative z-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-red-600 to-red-800 shadow-2xl">
            {shouldRedirect ? (
              <LoadingSpinner size="md" />
            ) : (
              <BookOpen className="h-8 w-8 text-white" />
            )}
          </div>
          <h1 className="text-foreground text-2xl font-bold">LFA</h1>
          {shouldRedirect && (
            <p className="text-muted-foreground mt-2 text-sm">
              {t('landing.redirecting')}
            </p>
          )}
          {loading && (
            <div className="mt-4 flex justify-center">
              <LoadingSpinner size="md" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Pricing Modal */}
      <AnimatePresence>
        {activePlan && (
          <PricingModal plan={activePlan} onClose={() => setActivePlan(null)} />
        )}
      </AnimatePresence>

      {/* Mobile fullscreen menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            className="fixed inset-0 z-100 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="absolute top-5 right-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/80 hover:bg-white/15"
            >
              <X className="h-5 w-5" />
            </button>
            <span className="mb-8 text-2xl font-black text-red-500">LFA</span>
            <nav className="grid w-full max-w-xs grid-cols-2 gap-3 px-6">
              {navLinks.map(link => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => {
                    setActiveSection(link.href.slice(1));
                    setMobileMenuOpen(false);
                  }}
                  className={`rounded-xl border px-3 py-3 text-center text-sm font-medium transition-all ${
                    activeSection === link.href.slice(1)
                      ? 'border-red-500/50 bg-red-500/20 text-white'
                      : 'border-white/8 bg-white/5 text-white/75 hover:border-red-500/30 hover:bg-red-500/10 hover:text-white'
                  }`}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="mt-8 flex items-center gap-3">
              <Button
                onClick={() => {
                  setMobileMenuOpen(false);
                  router.push('/login');
                }}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                {t('landing.header.signIn')}
              </Button>
              <Button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setActivePlan('Pro');
                }}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {t('landing.header.ctaBtn')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-background relative">
        {/* ── HEADER ─────────────────────────────────────────────────────────── */}
        <header className="border-border/40 bg-background/80 fixed top-0 right-0 left-0 z-50 border-b backdrop-blur-lg">
          <div className="mx-auto flex h-16 max-w-275 items-center justify-between px-5 md:px-10">
            <a
              href="#hero"
              className="text-3xl font-black tracking-tight text-red-600 transition-opacity hover:opacity-80"
            >
              LFA
            </a>
            <nav
              className="border-border/70 bg-muted/40 hidden items-center gap-0.5 rounded-full border px-1.5 py-1 md:flex"
              style={{ minWidth: '420px', justifyContent: 'center' }}
            >
              {navLinks.map(link => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setActiveSection(link.href.slice(1))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    activeSection === link.href.slice(1)
                      ? 'bg-red-600 text-white shadow-sm shadow-red-600/30'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground'
                  }`}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <LanguageToggle variant="icon" className="shrink-0" />
              <ThemeToggle variant="icon" className="shrink-0" />
              <Button
                onClick={() => router.push('/login')}
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground hidden min-w-24 justify-center sm:inline-flex"
              >
                {t('landing.header.signIn')}
              </Button>
              <Button
                onClick={() => setActivePlan('Pro')}
                size="sm"
                className="min-w-38 justify-center bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-700"
              >
                {t('landing.header.ctaBtn')}
              </Button>
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="border-border flex h-9 w-9 items-center justify-center rounded-lg border md:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* ── HERO ───────────────────────────────────────────────────────────── */}
        <section
          id="hero"
          className="relative flex min-h-screen items-center justify-center overflow-hidden pt-16"
        >
          <div className="via-background to-background pointer-events-none absolute inset-0 bg-linear-to-br from-red-950/40" />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 70% 55% at 50% 40%, rgba(220,38,38,0.08) 0%, transparent 65%)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px)',
              backgroundSize: '72px 72px',
            }}
          />
          <div
            className="pointer-events-none absolute top-20 left-[10%] h-125 w-125 animate-pulse rounded-full bg-red-600/4 blur-[120px]"
            style={{ animationDuration: '8s' }}
          />
          <div
            className="pointer-events-none absolute right-[5%] bottom-20 h-100 w-100 animate-pulse rounded-full bg-purple-600/3 blur-[100px]"
            style={{ animationDuration: '12s' }}
          />

          <div className="relative z-10 mx-auto max-w-225 px-5 pt-8 pb-24 text-center">
            <motion.div variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeUp} className="mb-6">
                <span className="inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/8 px-4 py-1.5 text-xs font-semibold tracking-wider text-red-600 uppercase">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  {t('landing.hero.badge')}
                </span>
              </motion.div>

              <motion.h1
                variants={fadeUp}
                className="text-foreground mb-6 text-5xl leading-[1.05] font-black tracking-tight md:text-7xl lg:text-8xl"
              >
                {t('landing.hero.titleLine1')}
                <br />
                <span className="bg-linear-to-r from-red-500 to-red-700 bg-clip-text text-transparent">
                  {t('landing.hero.titleLine2')}
                </span>
              </motion.h1>

              <motion.p
                variants={fadeUp}
                className="text-muted-foreground mx-auto mb-10 max-w-150 text-lg leading-relaxed md:text-xl"
              >
                {t('landing.hero.subtitle')}
              </motion.p>

              <motion.div
                variants={fadeUp}
                className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
              >
                <Button
                  onClick={() => setActivePlan('Pro')}
                  size="lg"
                  className="bg-red-600 px-8 py-6 text-base font-bold text-white shadow-xl shadow-red-600/30 transition-all hover:bg-red-700 hover:shadow-red-600/40"
                >
                  {t('landing.header.ctaBtn')}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  onClick={() => router.push('/demo')}
                  size="lg"
                  variant="outline"
                  className="border-border/60 hover:bg-muted px-8 py-6 text-base"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  {t('landing.hero.demoBtn')}
                </Button>
              </motion.div>

              <motion.div
                variants={fadeUp}
                className="mt-16 flex flex-wrap items-center justify-center gap-8"
              >
                {[
                  {
                    icon: GraduationCap,
                    label: t('landing.hero.trust1'),
                    sub: t('landing.hero.trust1Sub'),
                  },
                  {
                    icon: Brain,
                    label: t('landing.hero.trust2'),
                    sub: t('landing.hero.trust2Sub'),
                  },
                  {
                    icon: Shield,
                    label: t('landing.hero.trust3'),
                    sub: t('landing.hero.trust3Sub'),
                  },
                  {
                    icon: Award,
                    label: t('landing.hero.trust4'),
                    sub: t('landing.hero.trust4Sub'),
                  },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10">
                      <item.icon className="h-4 w-4 text-red-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-foreground text-sm font-semibold">
                        {item.label}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {item.sub}
                      </p>
                    </div>
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </div>
          <div className="to-background absolute right-0 bottom-0 left-0 h-24 bg-linear-to-b from-transparent" />
        </section>

        {/* ── SOLUTION ────────────────────────────────────────────────────────── */}
        <section className="bg-background relative mt-24 pb-24 md:pb-32">
          <div className="mx-auto max-w-275 px-5 md:px-10">
            <div className="mb-12 grid grid-cols-1 gap-5 md:grid-cols-3">
              {[
                {
                  tag: t('landing.solution.card1.tag'),
                  title: t('landing.solution.card1.title'),
                  desc: t('landing.solution.card1.desc'),
                  check: t('landing.solution.card1.check'),
                  icon: FileText,
                },
                {
                  tag: t('landing.solution.card2.tag'),
                  title: t('landing.solution.card2.title'),
                  desc: t('landing.solution.card2.desc'),
                  check: t('landing.solution.card2.check'),
                  icon: Brain,
                },
                {
                  tag: t('landing.solution.card3.tag'),
                  title: t('landing.solution.card3.title'),
                  desc: t('landing.solution.card3.desc'),
                  check: t('landing.solution.card3.check'),
                  icon: TrendingUp,
                },
              ].map((item, i) => (
                <Reveal key={item.tag} delay={i * 0.12}>
                  <div className="flex h-full flex-col rounded-2xl border border-red-500/22 bg-red-500/5 p-7 transition-transform hover:-translate-y-1">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/15">
                        <item.icon className="h-5 w-5 text-red-500" />
                      </div>
                      <span className="text-xs font-bold tracking-widest text-red-500 uppercase">
                        {item.tag}
                      </span>
                    </div>
                    <h3 className="text-foreground mb-3 text-xl font-bold tracking-tight">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground mb-6 flex-1 text-sm leading-relaxed">
                      {item.desc}
                    </p>
                    <div className="border-t border-red-500/18 pt-4">
                      <span className="text-sm font-bold text-red-400">
                        ✓ {item.check}
                      </span>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal>
              <div className="rounded-2xl border border-red-500/14 bg-linear-to-br from-red-500/7 to-red-500/2 p-8">
                <div className="mb-6 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-red-500" />
                  <h3 className="text-foreground text-xl font-semibold">
                    {t('landing.solution.benefitsTitle')}
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  {[
                    {
                      title: t('landing.solution.benefit1.title'),
                      desc: t('landing.solution.benefit1.desc'),
                    },
                    {
                      title: t('landing.solution.benefit2.title'),
                      desc: t('landing.solution.benefit2.desc'),
                    },
                    {
                      title: t('landing.solution.benefit3.title'),
                      desc: t('landing.solution.benefit3.desc'),
                    },
                  ].map(b => (
                    <div key={b.title}>
                      <p className="text-foreground mb-1 text-sm font-semibold">
                        {b.title}
                      </p>
                      <p className="text-muted-foreground text-sm">{b.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── WHY LFA ─────────────────────────────────────────────────────────── */}
        <section
          id="warum-lfa"
          className="bg-background relative py-24 md:py-36"
        >
          <div className="mx-auto max-w-275 px-5 md:px-10">
            <div className="mb-20 text-center">
              <Reveal>
                <h2 className="text-foreground mb-5 text-3xl leading-[1.1] font-bold tracking-tight md:text-5xl">
                  {t('landing.why.titleLine1')}
                  <br />
                  {t('landing.why.titleLine2')}
                </h2>
                <p className="text-muted-foreground mx-auto max-w-155 text-lg leading-relaxed">
                  {t('landing.why.subtitle')}
                </p>
              </Reveal>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  tag: t('landing.why.card1.tag'),
                  title: t('landing.why.card1.title'),
                  desc: t('landing.why.card1.desc'),
                  tags: [
                    t('landing.why.card1.pill1'),
                    t('landing.why.card1.pill2'),
                  ],
                  icon: Shield,
                },
                {
                  tag: t('landing.why.card2.tag'),
                  title: t('landing.why.card2.title'),
                  desc: t('landing.why.card2.desc'),
                  tags: [
                    t('landing.why.card2.pill1'),
                    t('landing.why.card2.pill2'),
                  ],
                  icon: Star,
                },
                {
                  tag: t('landing.why.card3.tag'),
                  title: t('landing.why.card3.title'),
                  desc: t('landing.why.card3.desc'),
                  tags: [
                    t('landing.why.card3.pill1'),
                    t('landing.why.card3.pill2'),
                  ],
                  icon: MessageSquare,
                },
                {
                  tag: t('landing.why.card4.tag'),
                  title: t('landing.why.card4.title'),
                  desc: t('landing.why.card4.desc'),
                  tags: [
                    t('landing.why.card4.pill1'),
                    t('landing.why.card4.pill2'),
                  ],
                  icon: GraduationCap,
                },
                {
                  tag: t('landing.why.card5.tag'),
                  title: t('landing.why.card5.title'),
                  desc: t('landing.why.card5.desc'),
                  tags: [
                    t('landing.why.card5.pill1'),
                    t('landing.why.card5.pill2'),
                  ],
                  icon: Building2,
                },
                {
                  tag: t('landing.why.card6.tag'),
                  title: t('landing.why.card6.title'),
                  desc: t('landing.why.card6.desc'),
                  tags: [
                    t('landing.why.card6.pill1'),
                    t('landing.why.card6.pill2'),
                  ],
                  icon: Zap,
                },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 0.08}>
                  <div className="group flex h-full min-h-80 cursor-default flex-col rounded-2xl border border-white/8 bg-white/3 p-7 transition-all hover:-translate-y-1 hover:border-red-500/25 hover:bg-white/5">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors group-hover:border-red-500/30 group-hover:bg-red-500/10">
                        <item.icon className="h-5 w-5 text-[#9999a1] transition-colors group-hover:text-red-400" />
                      </div>
                      <span className="rounded bg-red-500/10 px-2 py-0.5 text-xs font-bold text-red-500">
                        {item.tag}
                      </span>
                    </div>
                    <h3 className="text-foreground mb-2 text-lg font-bold">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
                      {item.desc}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-1.5">
                      {item.tags.map(tag => (
                        <span
                          key={tag}
                          className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-[#8e8e96]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* gradient divider */}
        <div className="to-background from-background h-24 bg-linear-to-b" />

        {/* ── ROLES COMPARISON ────────────────────────────────────────────────── */}
        <section
          id="rollen"
          className="relative overflow-hidden py-24 md:py-32"
        >
          <div className="pointer-events-none absolute -top-32 -left-32 h-150 w-150 rounded-full bg-red-500/4 blur-[120px]" />
          <div className="pointer-events-none absolute -right-20 -bottom-32 h-125 w-125 rounded-full bg-blue-500/4 blur-[100px]" />
          <div className="relative mx-auto max-w-275 px-5 md:px-10">
            <div className="mb-16 text-center">
              <Reveal>
                <span className="mb-5 inline-block rounded-full border border-red-500/14 bg-red-500/6 px-3 py-1 text-xs font-semibold tracking-widest text-red-600 uppercase">
                  {t('landing.roles.badge')}
                </span>
                <h2 className="text-foreground mb-5 text-3xl leading-[1.1] font-bold tracking-tight md:text-5xl">
                  {t('landing.roles.title')}
                </h2>
                <p className="text-muted-foreground mx-auto max-w-155 text-lg leading-relaxed">
                  {t('landing.roles.subtitle')}
                </p>
              </Reveal>
            </div>
            <div className="space-y-8">
              {[
                {
                  role: t('landing.roles.trainer.role'),
                  title: t('landing.roles.trainer.title'),
                  isRed: true,
                  rows: [
                    {
                      before: t('landing.roles.trainer.row1.before'),
                      after: t('landing.roles.trainer.row1.after'),
                    },
                    {
                      before: t('landing.roles.trainer.row2.before'),
                      after: t('landing.roles.trainer.row2.after'),
                    },
                    {
                      before: t('landing.roles.trainer.row3.before'),
                      after: t('landing.roles.trainer.row3.after'),
                    },
                    {
                      before: t('landing.roles.trainer.row4.before'),
                      after: t('landing.roles.trainer.row4.after'),
                    },
                  ],
                },
                {
                  role: t('landing.roles.trainee.role'),
                  title: t('landing.roles.trainee.title'),
                  isRed: false,
                  rows: [
                    {
                      before: t('landing.roles.trainee.row1.before'),
                      after: t('landing.roles.trainee.row1.after'),
                    },
                    {
                      before: t('landing.roles.trainee.row2.before'),
                      after: t('landing.roles.trainee.row2.after'),
                    },
                    {
                      before: t('landing.roles.trainee.row3.before'),
                      after: t('landing.roles.trainee.row3.after'),
                    },
                    {
                      before: t('landing.roles.trainee.row4.before'),
                      after: t('landing.roles.trainee.row4.after'),
                    },
                  ],
                },
              ].map(section => {
                const accentHex = section.isRed ? '#ff2222' : '#38bdf8';
                return (
                  <Reveal key={section.role}>
                    <div
                      className="overflow-hidden rounded-2xl"
                      style={{
                        border: `1.5px solid ${accentHex}38`,
                        boxShadow: `0 12px 56px ${accentHex}12`,
                      }}
                    >
                      <div
                        className="flex items-center gap-5 px-8 py-6"
                        style={{
                          background: `${accentHex}10`,
                          borderBottom: `1px solid ${accentHex}22`,
                        }}
                      >
                        <div
                          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
                          style={{
                            background: `${accentHex}22`,
                            border: `1px solid ${accentHex}45`,
                          }}
                        >
                          {section.isRed ? (
                            <Users
                              className="h-7 w-7"
                              style={{ color: accentHex }}
                            />
                          ) : (
                            <GraduationCap
                              className="h-7 w-7"
                              style={{ color: accentHex }}
                            />
                          )}
                        </div>
                        <div>
                          <div
                            className="mb-1 text-xs font-bold tracking-widest uppercase"
                            style={{ color: accentHex }}
                          >
                            {section.role}
                          </div>
                          <h3 className="text-foreground text-2xl font-bold">
                            {section.title}
                          </h3>
                        </div>
                        <div
                          className="ml-auto hidden rounded-full px-4 py-1.5 text-xs font-bold sm:block"
                          style={{
                            background: `${accentHex}18`,
                            border: `1px solid ${accentHex}30`,
                            color: accentHex,
                          }}
                        >
                          {t('landing.roles.benefitsCount')}
                        </div>
                      </div>
                      <div
                        className="grid grid-cols-2 text-xs"
                        style={{ borderBottom: `1px solid ${accentHex}15` }}
                      >
                        <div className="text-muted-foreground px-8 py-3 font-bold tracking-widest uppercase">
                          {t('landing.roles.before')}
                        </div>
                        <div
                          className="px-8 py-3 font-bold tracking-widest uppercase"
                          style={{
                            color: accentHex,
                            borderLeft: `2px solid ${accentHex}25`,
                          }}
                        >
                          {t('landing.roles.withLfa')}
                        </div>
                      </div>
                      {section.rows.map((row, ri) => (
                        <div
                          key={ri}
                          className="grid grid-cols-2"
                          style={{
                            borderTop:
                              ri > 0 ? `1px solid ${accentHex}10` : undefined,
                          }}
                        >
                          <div className="px-6 py-5 md:px-8">
                            <div className="flex items-start gap-3">
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                className="mt-0.5 shrink-0"
                                style={{ color: '#cc4444' }}
                              >
                                <line
                                  x1="3"
                                  y1="3"
                                  x2="13"
                                  y2="13"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="13"
                                  y1="3"
                                  x2="3"
                                  y2="13"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                />
                              </svg>
                              <span className="text-muted-foreground decoration-muted-foreground/30 text-sm leading-relaxed line-through">
                                {row.before}
                              </span>
                            </div>
                          </div>
                          <div
                            className="px-6 py-5 md:px-8"
                            style={{
                              background: `${accentHex}05`,
                              borderLeft: `2px solid ${accentHex}22`,
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <CheckCircle
                                className="mt-0.5 h-4 w-4 shrink-0"
                                style={{ color: accentHex }}
                              />
                              <span className="text-foreground text-sm leading-relaxed">
                                {row.after}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── FEATURES ────────────────────────────────────────────────────────── */}
        <section
          id="funktionen"
          className="bg-muted/20 relative py-24 md:py-32"
        >
          <div className="mx-auto max-w-275 px-5 md:px-10">
            <div className="mb-16 text-center">
              <Reveal>
                <span className="mb-4 inline-block rounded-full border border-red-500/14 bg-red-500/6 px-3 py-1 text-xs font-semibold tracking-widest text-red-600 uppercase">
                  {t('landing.features.badge')}
                </span>
                <h2 className="text-foreground mb-5 text-3xl leading-[1.1] font-bold tracking-tight md:text-5xl">
                  {t('landing.features.titleLine1')}
                  <br />
                  {t('landing.features.titleLine2')}
                </h2>
                <p className="text-muted-foreground mx-auto max-w-155 text-lg leading-relaxed">
                  {t('landing.features.subtitle')}
                </p>
              </Reveal>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: BookOpen,
                  title: t('landing.features.item1.title'),
                  desc: t('landing.features.item1.desc'),
                },
                {
                  icon: Brain,
                  title: t('landing.features.item2.title'),
                  desc: t('landing.features.item2.desc'),
                },
                {
                  icon: FileText,
                  title: t('landing.features.item3.title'),
                  desc: t('landing.features.item3.desc'),
                },
                {
                  icon: Users,
                  title: t('landing.features.item4.title'),
                  desc: t('landing.features.item4.desc'),
                },
                {
                  icon: Calendar,
                  title: t('landing.features.item5.title'),
                  desc: t('landing.features.item5.desc'),
                },
                {
                  icon: TrendingUp,
                  title: t('landing.features.item6.title'),
                  desc: t('landing.features.item6.desc'),
                },
                {
                  icon: Award,
                  title: t('landing.features.item7.title'),
                  desc: t('landing.features.item7.desc'),
                },
                {
                  icon: Building2,
                  title: t('landing.features.item8.title'),
                  desc: t('landing.features.item8.desc'),
                },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 0.06}>
                  <div className="group border-border bg-background flex h-full min-h-55 cursor-default flex-col rounded-2xl border p-6 transition-all hover:-translate-y-1 hover:border-red-500/30 hover:shadow-lg hover:shadow-red-500/5">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/15 bg-red-500/8 transition-all group-hover:border-red-500/30 group-hover:bg-red-500/15">
                      <item.icon className="h-5 w-5 text-red-600" />
                    </div>
                    <h3 className="text-foreground mb-2 font-semibold">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground flex-1 text-xs leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── UNIVERSUM ───────────────────────────────────────────────────────── */}
        <section
          id="universum"
          className="bg-background relative overflow-hidden py-24 md:py-36"
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 70% 50% at 50% 30%, rgba(220,38,38,0.05) 0%, transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-275 px-5 text-center md:px-10">
            <Reveal>
              <span className="mb-5 inline-block rounded-full border border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs font-semibold tracking-wider text-red-500 uppercase">
                {t('landing.universe.badge')}
              </span>
              <h2 className="text-foreground mb-5 text-3xl leading-[1.1] font-bold tracking-tight md:text-5xl">
                {t('landing.universe.titlePart1')}{' '}
                <span className="text-red-500">→</span>{' '}
                {t('landing.universe.titlePart2')}
              </h2>
              <p className="text-muted-foreground mx-auto mb-10 max-w-145 text-lg leading-relaxed">
                {t('landing.universe.subtitlePre')}{' '}
                <strong className="text-[#ff6060]">FIAE</strong>{' '}
                {t('landing.universe.subtitlePost')}
              </p>
            </Reveal>

            {/* Legend */}
            <Reveal>
              <div className="mb-8 flex flex-wrap justify-center gap-3 md:gap-5">
                {[
                  {
                    dotClass: 'h-3 w-3 bg-red-500 shadow-lg shadow-red-500/40',
                    label: t('landing.universe.lernfeld'),
                    sub: t('landing.universe.lernfeldSub'),
                  },
                  {
                    dotClass: 'h-2.5 w-2.5 bg-slate-200 shadow-slate-400/20',
                    label: t('landing.universe.komponente'),
                    sub: t('landing.universe.komponenteSub'),
                  },
                  {
                    dotClass: 'h-2 w-2 bg-sky-400 shadow-md shadow-sky-400/30',
                    label: t('landing.universe.useCase'),
                    sub: t('landing.universe.useCaseSub'),
                  },
                ].map(item => (
                  <div
                    key={item.label}
                    className="flex items-start gap-2.5 rounded-xl border border-white/6 bg-white/3 px-3.5 py-2.5 text-left"
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded-full ${item.dotClass}`}
                    />
                    <div>
                      <p className="text-foreground text-xs font-bold">
                        {item.label}
                      </p>
                      <p className="text-muted-foreground text-[0.65rem]">
                        {item.sub}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* Interactive canvas */}
            <div className="border-border overflow-hidden rounded-2xl border bg-black shadow-2xl shadow-black/20">
              <SolarSystemCanvas />
            </div>

            <p className="text-muted-foreground mt-3 text-xs tracking-wider">
              {t('landing.universe.comingSoon')}
            </p>
          </div>
        </section>

        {/* ── PRICING ─────────────────────────────────────────────────────────── */}
        <section
          id="preise"
          className="bg-background relative overflow-hidden py-24 md:py-36"
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 60% 50% at 50% 20%, rgba(220,38,38,0.07) 0%, transparent 65%)',
            }}
          />
          <div className="pointer-events-none absolute top-0 left-[15%] h-100 w-0.5 bg-linear-to-b from-transparent via-red-500/20 to-transparent" />
          <div className="pointer-events-none absolute top-0 right-[15%] h-100 w-0.5 bg-linear-to-b from-transparent via-red-500/10 to-transparent" />

          <div className="relative mx-auto max-w-275 px-5 md:px-10">
            <div className="mb-16 text-center">
              <Reveal>
                <span className="mb-5 inline-block rounded-full border border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs font-semibold tracking-wider text-red-500 uppercase">
                  {t('landing.pricing.badge')}
                </span>
                <h2 className="text-foreground mb-4 text-4xl leading-[1.08] font-black tracking-tight md:text-6xl">
                  {t('landing.pricing.titleLine1')}
                  <br />
                  {t('landing.pricing.titleLine2')}
                </h2>
                <p className="text-muted-foreground mx-auto max-w-130 text-base leading-relaxed md:text-lg">
                  {t('landing.pricing.subtitle')}
                </p>
              </Reveal>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* ── LIGHT ── */}
              <Reveal delay={0}>
                <div className="border-border bg-card group relative flex h-full cursor-default flex-col rounded-2xl border p-7 transition-all hover:-translate-y-2 hover:border-red-500/30 hover:shadow-xl hover:shadow-black/20">
                  <div className="absolute -top-3.5 left-1/2 z-10 -translate-x-1/2">
                    <span className="rounded-full border border-red-500/35 bg-red-500/18 px-4 py-1 text-xs font-bold text-red-300">
                      {t('landing.pricing.light.recommendedBadge')}
                    </span>
                  </div>
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                    <div
                      className="absolute top-0 -left-full h-full w-1/2 bg-linear-to-r from-transparent via-white/8 to-transparent"
                      style={{ animation: 'shimmer 6s ease-in-out infinite' }}
                    />
                  </div>
                  <div className="mb-6">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                      <BookOpen className="h-5 w-5 text-[#9999a1]" />
                    </div>
                    <span className="mb-1 block text-xs font-semibold tracking-widest text-[#9999a1] uppercase">
                      {t('landing.pricing.planLabel')}
                    </span>
                    <h3 className="text-foreground mb-1 text-2xl font-bold">
                      Light
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {t('landing.pricing.light.subtitle')}
                    </p>
                  </div>
                  <div className="border-border/50 mb-6 border-t pt-5">
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {t('landing.pricing.light.description')}
                    </p>
                  </div>
                  <ul className="mt-auto mb-8 space-y-3 text-sm">
                    {[
                      t('landing.pricing.light.feature1'),
                      t('landing.pricing.light.feature2'),
                      t('landing.pricing.light.feature3'),
                      t('landing.pricing.light.feature4'),
                      t('landing.pricing.light.feature5'),
                    ].map(f => (
                      <li
                        key={f}
                        className="text-muted-foreground flex items-center gap-2.5"
                      >
                        <CheckCircle className="h-4 w-4 shrink-0 text-[#9999a1]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mb-4 text-center">
                    <span className="text-foreground text-xl font-bold">
                      {t('landing.pricing.light.price')}
                    </span>
                  </div>
                  <Button
                    onClick={() => setActivePlan('Light')}
                    className="w-full bg-red-600 text-white hover:bg-red-700"
                  >
                    {t('landing.pricing.light.cta')}
                  </Button>
                </div>
              </Reveal>

              {/* ── PRO ── */}
              <Reveal delay={0.1}>
                <div className="border-border bg-card group relative flex h-full cursor-default flex-col rounded-2xl border p-7 transition-all hover:-translate-y-2 hover:border-red-500/30 hover:shadow-xl hover:shadow-black/20">
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="border-border bg-card text-muted-foreground rounded-full border px-4 py-1 text-xs font-bold">
                      {t('landing.pricing.pro.comingSoonBadge')}
                    </span>
                  </div>
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                    <div
                      className="absolute top-0 -left-full h-full w-1/2 bg-linear-to-r from-transparent via-white/10 to-transparent"
                      style={{ animation: 'shimmer 5s ease-in-out infinite' }}
                    />
                  </div>
                  <div className="mb-6">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                      <Zap className="h-5 w-5 text-[#9999a1]" />
                    </div>
                    <span className="mb-1 block text-xs font-semibold tracking-widest text-[#9999a1] uppercase">
                      {t('landing.pricing.planLabel')}
                    </span>
                    <h3 className="text-foreground mb-1 text-2xl font-bold">
                      Pro
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {t('landing.pricing.pro.subtitle')}
                    </p>
                  </div>
                  <div className="border-border/50 mb-6 border-t pt-5">
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {t('landing.pricing.pro.description')}
                    </p>
                  </div>
                  <ul className="mt-auto mb-8 space-y-3 text-sm">
                    {[
                      t('landing.pricing.pro.feature1'),
                      t('landing.pricing.pro.feature2'),
                      t('landing.pricing.pro.feature3'),
                      t('landing.pricing.pro.feature4'),
                      t('landing.pricing.pro.feature5'),
                      t('landing.pricing.pro.feature6'),
                    ].map(f => (
                      <li
                        key={f}
                        className="text-muted-foreground flex items-center gap-2.5"
                      >
                        <CheckCircle className="h-4 w-4 shrink-0 text-[#9999a1]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mb-4 text-center">
                    <span className="text-foreground text-xl font-bold">
                      {t('landing.pricing.pro.price')}
                    </span>
                  </div>
                  <Button
                    onClick={() => setActivePlan('Pro')}
                    className="w-full bg-red-600 text-white hover:bg-red-700"
                  >
                    {t('landing.pricing.pro.cta')}{' '}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </Reveal>

              {/* ── ENTERPRISE ── */}
              <Reveal delay={0.2}>
                <div className="border-border bg-card group relative flex h-full cursor-default flex-col rounded-2xl border p-7 transition-all hover:-translate-y-2 hover:border-red-500/30 hover:shadow-xl hover:shadow-black/20">
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                    <div
                      className="absolute top-0 -left-full h-full w-1/2 bg-linear-to-r from-transparent via-white/8 to-transparent"
                      style={{ animation: 'shimmer 6.5s ease-in-out infinite' }}
                    />
                  </div>
                  <div className="mb-6">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                      <Building2 className="h-5 w-5 text-[#9999a1]" />
                    </div>
                    <span className="mb-1 block text-xs font-semibold tracking-widest text-[#9999a1] uppercase">
                      {t('landing.pricing.planLabel')}
                    </span>
                    <h3 className="text-foreground mb-1 text-2xl font-bold">
                      Enterprise
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {t('landing.pricing.enterprise.subtitle')}
                    </p>
                  </div>
                  <div className="border-border/50 mb-6 border-t pt-5">
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {t('landing.pricing.enterprise.description')}
                    </p>
                  </div>
                  <ul className="mt-auto mb-8 space-y-3 text-sm">
                    {[
                      t('landing.pricing.enterprise.feature1'),
                      t('landing.pricing.enterprise.feature2'),
                      t('landing.pricing.enterprise.feature3'),
                      t('landing.pricing.enterprise.feature4'),
                      t('landing.pricing.enterprise.feature5'),
                      t('landing.pricing.enterprise.feature6'),
                      t('landing.pricing.enterprise.feature7'),
                    ].map(f => (
                      <li
                        key={f}
                        className="text-muted-foreground flex items-center gap-2.5"
                      >
                        <CheckCircle className="h-4 w-4 shrink-0 text-[#9999a1]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mb-4 text-center">
                    <span className="text-foreground text-xl font-bold">
                      {t('landing.pricing.enterprise.price')}
                    </span>
                  </div>
                  <Button
                    onClick={() => setActivePlan('Enterprise')}
                    className="w-full bg-red-600 text-white hover:bg-red-700"
                  >
                    {t('landing.pricing.enterprise.cta')}{' '}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </Reveal>
            </div>

            <Reveal>
              <p className="text-muted-foreground mt-12 text-center text-sm">
                {t('landing.pricing.footnote')}
              </p>
            </Reveal>
          </div>
        </section>

        <style>{`
          @keyframes shimmer {
            0%,100% { left: -100%; }
            50% { left: 150%; }
          }
        `}</style>

        {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
        <section id="faq" className="bg-background py-24 md:py-32">
          <div className="mx-auto max-w-180 px-5 md:px-10">
            <div className="mb-14 text-center">
              <Reveal>
                <h2 className="text-foreground mb-4 text-3xl font-bold tracking-tight md:text-5xl">
                  {t('landing.faq.title')}
                </h2>
                <p className="text-muted-foreground">
                  {t('landing.faq.subtitle')}
                </p>
              </Reveal>
            </div>
            <Reveal>
              <div className="border-border bg-background rounded-2xl border p-2">
                {[
                  {
                    q: t('landing.faq.q1.q'),
                    a: t('landing.faq.q1.a'),
                  },
                  {
                    q: t('landing.faq.q2.q'),
                    a: t('landing.faq.q2.a'),
                  },
                  {
                    q: t('landing.faq.q3.q'),
                    a: t('landing.faq.q3.a'),
                  },
                  {
                    q: t('landing.faq.q4.q'),
                    a: t('landing.faq.q4.a'),
                  },
                  {
                    q: t('landing.faq.q5.q'),
                    a: t('landing.faq.q5.a'),
                  },
                ].map(item => (
                  <FaqItem key={item.q} q={item.q} a={item.a} />
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── FINAL CTA ───────────────────────────────────────────────────────── */}
        <section className="bg-background relative overflow-hidden py-24 md:py-32">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(220,38,38,0.1) 0%, transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-180 px-5 text-center md:px-10">
            <Reveal>
              <span className="mb-5 inline-block rounded-full border border-red-500/25 bg-red-500/10 px-4 py-1.5 text-xs font-bold tracking-wider text-red-400 uppercase">
                {t('landing.cta.badge')}
              </span>
              <h2 className="text-foreground mb-6 text-4xl leading-[1.05] font-black tracking-tight md:text-6xl">
                {t('landing.cta.finalTitle')}
              </h2>
              <p className="text-muted-foreground mb-10 text-lg leading-relaxed">
                {t('landing.cta.finalSubtitle')}
              </p>
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <Button
                  onClick={() => setActivePlan('Pro')}
                  size="lg"
                  className="bg-red-600 px-8 py-6 text-base font-bold text-white shadow-xl shadow-red-600/30 hover:bg-red-700"
                >
                  {t('landing.header.ctaBtn')}{' '}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  onClick={() => router.push('/login')}
                  size="lg"
                  variant="outline"
                  className="border-border text-foreground hover:bg-muted px-8 py-6 text-base"
                >
                  {t('landing.cta.loginBtn')}
                </Button>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
        <footer className="border-border/40 bg-background border-t py-12">
          <div className="mx-auto max-w-275 px-5 md:px-10">
            <div className="flex flex-col items-center gap-8 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-2xl font-black text-red-600">LFA</span>
                  <span className="text-muted-foreground text-sm">
                    {t('landing.footer.tagline')}
                  </span>
                </div>
                <p className="text-muted-foreground max-w-70 text-sm">
                  {t('landing.footer.description')}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-6 md:justify-end">
                {navLinks.map(link => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
                <button
                  onClick={() => router.push('/login')}
                  className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                >
                  Anmelden
                </button>
              </div>
            </div>
            <div className="border-border/40 mt-8 border-t pt-8 text-center">
              <p className="text-muted-foreground text-xs">
                {t('landing.copyright')}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
