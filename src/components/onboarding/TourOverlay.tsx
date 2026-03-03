'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourOverlay() {
  const {
    isActive,
    currentStep,
    currentStepIndex,
    steps,
    nextStep,
    prevStep,
    skipTour,
  } = useOnboarding();
  const { t } = useLanguage();
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const observerRef = useRef<ResizeObserver | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const skipCountRef = useRef(0);

  const PAD = 10;

  /**
   * Check whether an element is truly user-visible:
   * – not zero-sized
   * – inside the viewport
   * – not clipped to zero by an overflow:hidden ancestor (e.g. collapsed sidebar)
   */
  const isElementVisible = useCallback((el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    if (rect.right <= 0 || rect.bottom <= 0) return false;
    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight)
      return false;

    // Walk up the tree: if any overflow-hidden ancestor has collapsed size or
    // fully clips the element, the target is invisible.
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      if (
        style.overflow === 'hidden' ||
        style.overflowX === 'hidden' ||
        style.overflowY === 'hidden'
      ) {
        const pr = parent.getBoundingClientRect();
        if (pr.width < 1 || pr.height < 1) return false;
        if (rect.right < pr.left || rect.left > pr.right) return false;
        if (rect.bottom < pr.top || rect.top > pr.bottom) return false;
      }
      parent = parent.parentElement;
    }
    return true;
  }, []);

  const calculatePositions = useCallback(() => {
    if (!currentStep) {
      setSpotlight(null);
      return;
    }

    const el = document.querySelector(currentStep.targetSelector);
    if (!el || !isElementVisible(el)) {
      setSpotlight(null);
      return;
    }

    const rect = el.getBoundingClientRect();
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
      tp = {
        top: sr.top + sr.height / 2 - tooltipH / 2,
        left: sr.left + sr.width + gap,
      };
    } else if (placement === 'left') {
      tp = {
        top: sr.top + sr.height / 2 - tooltipH / 2,
        left: sr.left - tooltipW - gap,
      };
    } else if (placement === 'bottom') {
      tp = {
        top: sr.top + sr.height + gap,
        left: sr.left + sr.width / 2 - tooltipW / 2,
      };
    } else {
      tp = {
        top: sr.top - tooltipH - gap,
        left: sr.left + sr.width / 2 - tooltipW / 2,
      };
    }

    // Clamp within viewport with padding
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    tp.left = Math.max(16, Math.min(vw - tooltipW - 16, tp.left));
    tp.top = Math.max(16, Math.min(vh - tooltipH - 16, tp.top));

    setTooltipPos(tp);
  }, [currentStep, isElementVisible]);

  // Auto-skip steps whose target element is not visible (e.g. sidebar collapsed)
  useEffect(() => {
    if (!isActive || !currentStep) {
      skipCountRef.current = 0;
      return;
    }

    const el = document.querySelector(currentStep.targetSelector);
    if (!el || !isElementVisible(el)) {
      // Guard against infinite loops: if we skipped more than the total steps, bail out
      if (skipCountRef.current >= steps.length) {
        skipCountRef.current = 0;
        skipTour();
        return;
      }
      skipCountRef.current++;
      nextStep();
      return;
    }

    // Target is visible — reset skip counter
    skipCountRef.current = 0;
  }, [
    isActive,
    currentStep,
    steps.length,
    nextStep,
    skipTour,
    isElementVisible,
  ]);

  useEffect(() => {
    if (!isActive || !currentStep) return;

    // Initial calc
    calculatePositions();

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
    const raf = requestAnimationFrame(() => calculatePositions());

    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('scroll', handle, true);
      observerRef.current?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [isActive, currentStep, calculatePositions]);

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
        <svg
          className="absolute inset-0 h-full w-full"
          style={{ pointerEvents: 'auto' }}
          onClick={skipTour}
        >
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
            className="border-primary/60 absolute rounded-xl border-2 shadow-[0_0_24px_hsl(var(--primary)/0.35)]"
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
          className="border-border bg-card absolute z-[9999] w-80 rounded-2xl border p-5 shadow-2xl backdrop-blur-xl"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
            pointerEvents: 'auto',
          }}
        >
          {/* Close button */}
          <button
            onClick={skipTour}
            className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-3 right-3 rounded-lg p-1 transition-colors"
            aria-label="Close tour"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Content */}
          <div className="pr-6">
            <h3 className="text-foreground text-base font-semibold">
              {t(currentStep.titleKey)}
            </h3>
            <p className="text-foreground/70 mt-2 text-sm leading-relaxed">
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
                      ? 'bg-primary h-2 w-5'
                      : idx < currentStepIndex
                        ? 'bg-primary/40 h-2 w-2'
                        : 'bg-muted-foreground/30 h-2 w-2'
                  }`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={skipTour}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-3 py-1.5 text-xs transition-colors"
              >
                {t('onboarding.skip')}
              </button>
              {!isFirst && (
                <button
                  onClick={prevStep}
                  className="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                >
                  <ChevronLeft className="h-3 w-3" />
                  {t('onboarding.back')}
                </button>
              )}
              <button
                onClick={nextStep}
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-colors"
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
