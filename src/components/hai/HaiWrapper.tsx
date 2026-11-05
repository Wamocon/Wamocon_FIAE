'use client';

/**
 * HAI.ai Wrapper Component
 *
 * Combines the floating button and chat panel for easy integration.
 * Just wrap your content or add to layout to enable HAI.ai.
 * Automatically handles user authentication context.
 *
 * @example
 * // In layout.tsx:
 * <HaiWrapper>
 *   {children}
 * </HaiWrapper>
 */

import React from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/AuthContext';
import { isAccountStopped } from '@/lib/auth/access-state';
import { HaiProvider, HaiContext, useHai } from './HaiProvider';
import { HaiDockProvider } from './HaiDockContext';
import { HaiQuizModeProvider } from './HaiQuizMode';
import { HaiVoiceSessionProvider } from './voice-mode/HaiVoiceSession';

// Lazy-load the button & chat panel — keeps framer-motion out of the
// critical-path bundle.  They are only downloaded once the wrapper mounts
// (i.e. the user is logged in).
const HaiButton = dynamic(() => import('./HaiButton').then(m => m.HaiButton), {
  ssr: false,
});
const HaiChat = dynamic(() => import('./HaiChat').then(m => m.HaiChat), {
  ssr: false,
});

/**
 * The panel is a column of the app layout (HaiDockColumn in MainLayout): the
 * dock provider needs to know whether the text chat is shown as a panel. It
 * sits inside the chat provider, above the pages, so the width and the panel
 * stay when the HAI opens another page.
 */
function HaiDockHost({ children }: { children: React.ReactNode }) {
  const { viewMode } = useHai();
  return (
    <HaiDockProvider open={viewMode === 'widget'}>{children}</HaiDockProvider>
  );
}

interface HaiWrapperProps {
  children?: React.ReactNode;
  context?: HaiContext;
}

export function HaiWrapper({ children, context }: HaiWrapperProps) {
  const { user, profile, subscriptionPlan } = useAuth();

  if (!user) {
    return <>{children}</>;
  }

  // An account that is stopped (not released, deactivated) sees a notice page
  // and nothing else, no chat either
  if (isAccountStopped(profile ?? null)) {
    return <>{children}</>;
  }

  // HAI is only available for PRO plan subscribers
  if (subscriptionPlan !== 'PRO') {
    return <>{children}</>;
  }

  return (
    <HaiQuizModeProvider>
      <HaiProvider userId={user.id} initialContext={context}>
        {/* The dock host sits ABOVE the voice session on purpose: the session
            renders the voice figure (HaiVoiceModeOverlay, in a portal), and the
            figure reads the dock (haiLayout.ts, useHaiAnchor) exactly like the
            HAI symbol, its pond. A portal keeps the context of the place where
            it is rendered, so the figure must be below the dock provider. Else
            it would not know the panel width and stand at a fixed offset next
            to the pond instead of in it. */}
        <HaiDockHost>
          <HaiVoiceSessionProvider>
            {children}
            <HaiButton />
            <HaiChat />
          </HaiVoiceSessionProvider>
        </HaiDockHost>
      </HaiProvider>
    </HaiQuizModeProvider>
  );
}

export default HaiWrapper;
