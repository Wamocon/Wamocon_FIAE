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
import { useAuth } from '@/contexts/AuthContext';
import { HaiProvider, HaiContext } from './HaiProvider';
import { HaiButton } from './HaiButton';
import { HaiChat } from './HaiChat';

interface HaiWrapperProps {
    children?: React.ReactNode;
    context?: HaiContext;
}

export function HaiWrapper({ children, context }: HaiWrapperProps) {
    const { user } = useAuth();

    // Only render HAI if user is logged in
    // If not logged in, just render children without the chat overlay
    if (!user) {
        return <>{children}</>;
    }

    return (
        <HaiProvider userId={user.id} initialContext={context}>
            {children}
            <HaiButton />
            <HaiChat />
        </HaiProvider>
    );
}

export default HaiWrapper;
