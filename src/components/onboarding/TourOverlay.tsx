'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourOverlay() {
  const { isActive, currentStep, currentStepIndex, steps, nextStep, prevStep, skipTour } = useOnboarding();
  const { t } = useLanguage();
  const sidebar = useSidebar();
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const sidebarOpenedByTour = useRef(false);

  const PAD = 10;

  // Check if a step targets a sidebar element
  const isSidebarStep = useCallback((selector: string) => {
    return selector.includes('data-tour="sidebar-');
  }, []);

  // Open sidebar when tour step targets sidebar items
  useEffect(() => {
    if (!isActive || !currentStep) {
      // Tour ended — close sidebar if we opened it
      if (sidebarOpenedByTour.current) {
        sidebar.close();
        sidebarOpenedByTour.current = false;
      }
      return;
    }

    if (isSidebarStep(currentStep.targetSelector)) {
      if (!sidebar.isOpen) {
        sidebar.open();
        sidebarOpenedByTour.current = true;
      }
    }
  }, [isActive, currentStep, sidebar, isSidebarStep]);

  const calculatePositions = useCallback(() => {
    if (!currentStep) {
      setSpotlight(null);
      return;
    }

    const el = document.querySelector(currentStep.targetSelector);
    if (!el) {
      setSpotlight(null);
      return;
    }

    const rect = el.getBoundingClientRect();

    // If the element is off-screen (e.g. sidebar hidden), skip spotlight
    if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
      setSpotlight(null);
      return;
    }

    const sr: SpotlightRect = {
      top: rect.top - PAD,
      left: rect.left - PAD,
      width: rect.width + PAD * 2,
      height: rect.height + PAD * 2,
    };
    setSpotlight(sr);

    // Measure actual tooltip height (fallback to estimate)
    const tooltipW = 320;
    const tooltipH = tooltipRef.current?.offsetHeight || 200;
    const gap = 12;
    let tp = { top: 0, left: 0 };
    const placement = currentStep.placement;

    if (placement === 'right') {
      tp = { top: sr.top + sr.height / 2 - tooltipH / 2, left: sr.left + sr.width + gap };
    } else if (placement === 'left') {
      tp = { top: sr.top + sr.height / 2 - tooltipH / 2, left: sr.left - tooltipW - gap };
    } else if (placement === 'bottom') {
      tp = { top: sr.top + sr.height + gap, left: sr.left + sr.width / 2 - tooltipW / 2 };
    } else {
      tp = { top: sr.top - tooltipH - gap, left: sr.left + sr.width / 2 - tooltipW / 2 };
    }

    // If tooltip would overflow right, flip to left of target
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (placement === 'right' && tp.left + tooltipW > vw - 16) {
      tp.left = sr.left - tooltipW - gap;
    }
    // If tooltip would overflow left, flip to right of target
    if (placement === 'left' && tp.left < 16) {
      tp.left = sr.left + sr.width + gap;
    }

    // Final clamp within viewport with padding
    tp.left = Math.max(16, Math.min(vw - tooltipW - 16, tp.left));
    tp.top = Math.max(16, Math.min(vh - tooltipH - 16, tp.top));

    setTooltipPos(tp);
  }, [currentStep]);

  useEffect(() => {
    if (!isActive || !currentStep) return;

    // If step targets sidebar, wait for sidebar animation to finish (300ms transition)
    const isSidebar = isSidebarStep(currentStep.targetSelector);
    const initialDelay = isSidebar ? 350 : 0;

    const initialTimer = setTimeout(() => {
      calculatePositions();
    }, initialDelay);

    // Recalculate on scroll/resize
    const handle = () => calculatePositions();
    window.addEventListener('resize', handle);
    window.addEventListener('scroll', handle, true);

    // Observe target element size changes
    const el = document.querySelector(currentStep.targetSelector);
    if (el) {
      observerRef.current = new ResizeObserver(handle);
      observerRef.current.observe(el);
    }

    // Re-calculate after tooltip renders so height measurement is accurate
    const raf = requestAnimationFrame(() => {
      setTimeout(() => calculatePositions(), isSidebar ? 350 : 50);
    });

    return () => {
      clearTimeout(initialTimer);
      window.removeEventListener('resize', handle);
      window.removeEventListener('scroll', handle, true);
      observerRef.current?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [isActive, currentStep, calculatePositions, isSidebarStep]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skipTour();
      if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep();
      if (e.key === 'ArrowLeft') prevStep();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isActive, skipTour, nextStep, prevStep]);

  if (!isActive || !currentStep) return null;

  const isLast = currentStepIndex === steps.length - 1;
  const isFirst = currentStepIndex === 0;

  // SVG mask for spotlight cutout
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;

  return (
    <AnimatePresence>
      <motion.div
        key="tour-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[9998]"
        style={{ pointerEvents: 'none' }}
      >
        {/* Dark backdrop with spotlight cutout */}
        <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'auto' }} onClick={skipTour}>
          <defs>
            <mask id="tour-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {spotlight && (
                <rect
                  x={spotlight.left}
                  y={spotlight.top}
                  width={spotlight.width}
                  height={spotlight.height}
                  rx="12"
                  ry="12"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width={vw}
            height={vh}
            fill="rgba(0,0,0,0.5)"
            mask="url(#tour-spotlight-mask)"
          />
        </svg>

        {/* Spotlight border glow */}
        {spotlight && (
          <div
            className="absolute rounded-xl border-2 border-primary/60 shadow-[0_0_24px_hsl(var(--primary)/0.35)]"
            style={{
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Tooltip card */}
        <motion.div
          ref={tooltipRef}
          key={currentStep.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, delay: 0.05 }}
          className="absolute z-[9999] w-[min(320px,calc(100vw-32px))] rounded-2xl border border-border bg-card p-5 shadow-2xl backdrop-blur-xl"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
            pointerEvents: 'auto',
          }}
        >
          {/* Close button */}
          <button
            onClick={skipTour}
            className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close tour"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Content */}
          <div className="pr-6">
            <h3 className="text-base font-semibold text-foreground">
              {t(currentStep.titleKey)}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/70">
              {t(currentStep.descriptionKey)}
            </p>
          </div>

          {/* Footer: dots + buttons */}
          <div className="mt-4 flex items-center justify-between">
            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {steps.map((_, idx) => (
                <div
                  key={idx}
                  className={`rounded-full transition-all ${
                    idx === currentStepIndex
                      ? 'h-2 w-5 bg-primary'
                      : idx < currentStepIndex
                        ? 'h-2 w-2 bg-primary/40'
                        : 'h-2 w-2 bg-muted-foreground/30'
                  }`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={skipTour}
                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t('onboarding.skip')}
              </button>
              {!isFirst && (
                <button
                  onClick={prevStep}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                >
                  <ChevronLeft className="h-3 w-3" />
                  {t('onboarding.back')}
                </button>
              )}
              <button
                onClick={nextStep}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {isLast ? t('onboarding.finish') : t('onboarding.next')}
                {!isLast && <ChevronRight className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
