'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { GraduationCap, Eye, EyeOff, Loader2 } from 'lucide-react'

export function LoginForm() {
  const { signIn, switchRole } = useAuth()
  const [email, setEmail] = useState('elias.felsing@azubi.de')
  const [password, setPassword] = useState('password123')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [currentRole, setCurrentRole] = useState<'trainee' | 'trainer'>('trainee')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    
    try {
      await signIn(email, password)
    } catch (error) {
      console.error('Login failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSwitchRole = (role: 'trainee' | 'trainer') => {
    setCurrentRole(role)
    if (role === 'trainer') {
      setEmail('ausbilder@wamocon.de')
    } else {
      setEmail('elias.felsing@azubi.de')
    }
    switchRole(role)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="w-full max-w-md p-8 space-y-8 bg-gray-800 rounded-2xl shadow-2xl">
        <div>
          <h2 className="text-4xl font-bold text-center text-white">FIAE-Lernplattform</h2>
          <p className="mt-2 text-center text-gray-400">Willkommen zurück!</p>
        </div>
        
        {/* Role Selector */}
        <div className="flex bg-gray-700 rounded-lg p-1">
          <button
            onClick={() => handleSwitchRole('trainee')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              currentRole === 'trainee'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Auszubildender
          </button>
          <button
            onClick={() => handleSwitchRole('trainer')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              currentRole === 'trainer'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Ausbilder
          </button>
        </div>
        
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="text-sm font-medium text-gray-300">E-Mail-Adresse</label>
            <input 
              id="email" 
              name="email" 
              type="email" 
              autoComplete="email" 
              required 
              className="w-full px-4 py-3 mt-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white" 
              placeholder="ihre.email@beispiel.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          
          <div>
            <label htmlFor="password" className="text-sm font-medium text-gray-300">Passwort</label>
            <div className="relative">
              <input 
                id="password" 
                name="password" 
                type={showPassword ? 'text' : 'password'} 
                autoComplete="current-password" 
                required 
                className="w-full px-4 py-3 pr-12 mt-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white" 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          
          <div>
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full py-3 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-600/50 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Anmelden...
                </div>
              ) : (
                'Anmelden'
              )}
            </button>
          </div>
        </form>
        
        <div className="text-center text-xs text-gray-500">
          <p>Demo-Anmeldung: {email}</p>
          <p>Passwort: password123</p>
        </div>
      </div>
    </div>
  )
}
