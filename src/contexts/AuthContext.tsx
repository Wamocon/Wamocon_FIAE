'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// Mock user data
const mockUsers = {
  'elias.felsing@azubi.de': {
    id: 'user_1',
    email: 'elias.felsing@azubi.de',
    full_name: 'Elias Felsing',
    role: 'trainee' as const,
    avatar: null,
    training_start_date: '2024-09-01',
    trainer_id: 'trainer_1'
  },
  'ausbilder@wamocon.de': {
    id: 'trainer_1',
    email: 'ausbilder@wamocon.de',
    full_name: 'Max Mustermann',
    role: 'trainer' as const,
    avatar: null,
    training_start_date: null,
    trainer_id: null
  }
}

// Mock authentication state - moved outside component to prevent recreation
let mockAuthState: {
  user: User | null
  profile: Profile | null
  isAuthenticated: boolean
} = {
  user: null,
  profile: null,
  isAuthenticated: false
}

// Create a mock Supabase client - moved outside component
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-key'
)

interface User {
  id: string
  email: string
}

interface Profile {
  id: string
  email: string
  full_name: string
  role: 'trainee' | 'trainer'
  avatar?: string | null
  training_start_date?: string | null
  trainer_id?: string | null
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  switchRole: (newRole: 'trainee' | 'trainer') => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isInitialized, setIsInitialized] = useState(false)
  const authCheckRef = useRef<NodeJS.Timeout>()

  // Check for existing session on mount - optimized to run only once
  useEffect(() => {
    if (isInitialized) return

    const checkAuth = () => {
      try {
        // Check localStorage for existing session
        const savedUser = localStorage.getItem('mockUser')
        const savedProfile = localStorage.getItem('mockProfile')
        
        if (savedUser && savedProfile) {
          const userData = JSON.parse(savedUser)
          const profileData = JSON.parse(savedProfile)
          
          setUser(userData)
          setProfile(profileData)
          mockAuthState = {
            user: userData,
            profile: profileData,
            isAuthenticated: true
          }
        }
      } catch (error) {
        console.error('Error parsing saved auth data:', error)
        localStorage.removeItem('mockUser')
        localStorage.removeItem('mockProfile')
      } finally {
        setLoading(false)
        setIsInitialized(true)
      }
    }

    // Clear any existing timeout
    if (authCheckRef.current) {
      clearTimeout(authCheckRef.current)
    }

    // Add small delay to prevent rapid state changes
    authCheckRef.current = setTimeout(checkAuth, 100)

    return () => {
      if (authCheckRef.current) {
        clearTimeout(authCheckRef.current)
      }
    }
  }, [isInitialized])

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true)
    
    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Check if user exists in mock data
      const userProfile = mockUsers[email as keyof typeof mockUsers]
      
      if (!userProfile) {
        throw new Error('User not found')
      }
      
      // Create user object
      const userData: User = {
        id: userProfile.id,
        email: userProfile.email
      }
      
      // Set authentication state
      setUser(userData)
      setProfile(userProfile)
      
      // Update mock state
      mockAuthState = {
        user: userData,
        profile: userProfile,
        isAuthenticated: true
      }
      
      // Save to localStorage
      try {
        localStorage.setItem('mockUser', JSON.stringify(userData))
        localStorage.setItem('mockProfile', JSON.stringify(userProfile))
      } catch (error) {
        console.error('Error saving to localStorage:', error)
      }
      
    } catch (error) {
      console.error('Sign in error:', error)
      throw new Error('Invalid login credentials')
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setLoading(true)
    
    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Clear authentication state
      setUser(null)
      setProfile(null)
      
      // Update mock state
      mockAuthState = {
        user: null,
        profile: null,
        isAuthenticated: false
      }
      
      // Clear localStorage
      try {
        localStorage.removeItem('mockUser')
        localStorage.removeItem('mockProfile')
      } catch (error) {
        console.error('Error clearing localStorage:', error)
      }
      
    } catch (error) {
      console.error('Sign out error:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const switchRole = useCallback((newRole: 'trainee' | 'trainer') => {
    if (profile) {
      const updatedProfile = { ...profile, role: newRole }
      setProfile(updatedProfile)
      
      // Update mock state
      mockAuthState.profile = updatedProfile
      
      // Update localStorage
      try {
        localStorage.setItem('mockProfile', JSON.stringify(updatedProfile))
      } catch (error) {
        console.error('Error updating localStorage:', error)
      }
    }
  }, [profile])

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo<AuthContextType>(() => ({
    user,
    profile,
    loading,
    signIn,
    signOut,
    switchRole
  }), [user, profile, loading, signIn, signOut, switchRole])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
