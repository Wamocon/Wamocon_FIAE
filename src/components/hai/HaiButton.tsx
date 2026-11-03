'use client';

/**
 * HAI symbol: the round fish pond with the pixel shark (shark-new.gif).
 *
 * It sits at the bottom left of the page and is the handle of the chat panel:
 * a click slides the panel in from the left, another click slides it back. While
 * the panel is open the symbol rides on its right edge (haiLayout.ts), stays
 * visible and clickable and shows a small arrow.
 *
 * In the voice mode the symbol itself becomes the pond of the HAI figure: the
 * same round pond, grown (scale only, so the border and the glow grow with it),
 * the pixel shark fades out and the figure rises out of the water (HaiCharacter,
 * HaiVoiceModeOverlay). When the mode ends the figure dives in and the symbol
 * shrinks back to the button.
 */

import React from 'react';
import Image from 'next/image';
import { useHai } from './HaiProvider';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { HAI_PANEL_ID, useHaiAnchor } from './haiLayout';
import { useOptionalHaiVoiceSession } from './voice-mode/voiceSessionContext';
import { usePondState } from './voice-mode/usePondState';

export function HaiButton() {
  const { viewMode, toggleChat, messages, setViewMode } = useHai();
  const { t } = useLanguage();
  const anchor = useHaiAnchor();
  const voice = useOptionalHaiVoiceSession();
  const { pond } = usePondState(voice?.view ?? 'closed');

  if (viewMode === 'full') return null;

  const isActive = viewMode !== 'hidden' && viewMode !== 'minimized';
  const hasMessages = messages.length > 0;

  return (
    // z-40, one level under the viewers and dialogs (z-50): the button is
    // part of the page, an open viewer or dialog lies over it (WMCNL-2969).
    // Bottom left: the HAI lives at the left (haiLayout.ts).
    <div
      className={`${anchor.className} flex flex-col items-start gap-2`}
      data-tour="hai-button"
      data-hai-anchor=""
      data-panel={isActive ? 'open' : 'closed'}
    >
      {/* Minimized Indicator */}
      <AnimatePresence>
        {viewMode === 'minimized' && hasMessages && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-card border-border/50 hover:bg-accent/50 mb-2 flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2 shadow-lg transition-colors"
            onClick={() => setViewMode('widget')}
          >
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-500"></span>
            </span>
            <span className="text-sm font-medium">
              {t('hai.button.continueChat')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The pond: scaled up as a whole in the voice mode */}
      <div
        data-pond={pond ? 'true' : 'false'}
        className={`group relative origin-bottom-left transition-transform duration-500 ease-out motion-reduce:transition-none ${
          pond ? 'scale-[2] sm:scale-[2.8]' : ''
        }`}
      >
        {/* Main Button */}
        <motion.button
          type="button"
          data-hai-handle=""
          onClick={toggleChat}
          whileHover={pond ? undefined : { scale: 1.05 }}
          whileTap={pond ? undefined : { scale: 0.95 }}
          aria-expanded={isActive}
          aria-controls={HAI_PANEL_ID}
          className={`relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 bg-[#242845] shadow-xl shadow-cyan-500/40 transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020b1c] focus-visible:outline-none sm:h-20 sm:w-20 ${
            isActive ? 'border-cyan-400/80' : 'border-cyan-500/40'
          }`}
          aria-label={isActive ? t('hai.button.close') : t('hai.button.open')}
        >
          {/* Glow Ring */}
          {!isActive && !pond && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(34, 211, 238, 0.2) 0%, transparent 70%)',
              }}
              animate={{
                scale: [1, 1.1, 1],
                opacity: [0.5, 0.8, 0.5],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          )}

          {/* The pixel shark: the symbol. It fades out when the pond is a pond. */}
          <span
            className={`relative block h-full w-full transition-opacity duration-500 motion-reduce:transition-none ${
              pond ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <Image
              src="/images/shark-new.gif"
              alt="HAI"
              fill
              className="scale-110 object-cover"
              unoptimized
            />
          </span>

          {/* The panel is open: the symbol shows that a click slides it back */}
          {isActive && !pond && (
            <span
              aria-hidden="true"
              data-testid="hai-handle-arrow"
              className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400 text-[#06183a] shadow"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </span>
          )}
        </motion.button>

        {/* Hover Tooltip: right of the symbol (the page is to its right), outside
            of the round button so it is not clipped */}
        {!isActive && !pond && (
          <span className="bg-popover text-popover-foreground border-border/50 pointer-events-none absolute top-1/2 left-full ml-4 hidden -translate-x-2 -translate-y-1/2 rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap opacity-0 shadow-md transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 sm:block">
            {t('hai.button.askHai')}
          </span>
        )}
      </div>
    </div>
  );
}

export default HaiButton;
