'use client'

import { useState } from 'react'
import { Target, TrendingUp, Send, CheckCircle } from 'lucide-react'

interface ReflectionData {
  strengths: string
  weaknesses: string
  more: string
  equal: string
}

export function Reflection() {
  const [reflectionData, setReflectionData] = useState<ReflectionData>({
    strengths: '',
    weaknesses: '',
    more: '',
    equal: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleInputChange = (field: keyof ReflectionData, value: string) => {
    setReflectionData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate submission
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    setIsSubmitting(false)
    setIsSubmitted(true)
    
    // Reset form after showing success
    setTimeout(() => {
      setIsSubmitted(false)
      setReflectionData({
        strengths: '',
        weaknesses: '',
        more: '',
        equal: ''
      })
    }, 3000)
  }

  if (isSubmitted) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass-effect p-8 rounded-3xl shadow-lg text-center max-w-md">
          <div className="w-20 h-20 bg-gradient-to-br from-accent to-primary rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Reflektion erfolgreich gespeichert! 🎉</h2>
          <p className="text-muted">
            Deine Reflektion wurde erfolgreich gespeichert und wird von deinem Ausbilder überprüft.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header Section */}
      <div className="glass-effect p-8 rounded-3xl shadow-lg mb-8">
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-accent to-primary rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Target className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Reflektionstermin Q3/2025</h1>
          <p className="text-muted">
            Nutze die SWOT- und MES-Methode, um deinen Lernfortschritt und deine Erfahrungen zu reflektieren.
          </p>
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* SWOT and MES Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* SWOT Analysis - Left Column */}
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-foreground mb-4">SWOT-Analyse</h2>
            
            {/* Strengths */}
            <div>
              <label className="block text-sm font-medium text-accent mb-2">
                Stärken (Strengths)
              </label>
              <textarea 
                rows={4} 
                value={reflectionData.strengths}
                onChange={(e) => handleInputChange('strengths', e.target.value)}
                className="w-full bg-background/50 border border-accent/30 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-accent text-foreground resize-none"
                placeholder="Was lief besonders gut?"
                required
              />
            </div>

            {/* Weaknesses */}
            <div>
              <label className="block text-sm font-medium text-accent mb-2">
                Schwächen (Weaknesses)
              </label>
              <textarea 
                rows={4} 
                value={reflectionData.weaknesses}
                onChange={(e) => handleInputChange('weaknesses', e.target.value)}
                className="w-full bg-background/50 border border-accent/30 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-accent text-foreground resize-none"
                placeholder="Wo hattest du Schwierigkeiten?"
                required
              />
            </div>
          </div>

          {/* MES Feedback - Right Column */}
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-white mb-4">MES-Feedback</h2>
            
            {/* More */}
            <div>
              <label className="block text-sm font-medium text-accent mb-2">
                Mehr davon (More)
              </label>
              <textarea 
                rows={4} 
                value={reflectionData.more}
                onChange={(e) => handleInputChange('more', e.target.value)}
                className="w-full bg-background/50 border border-accent/30 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-accent text-foreground resize-none"
                placeholder="Was hat dir besonders geholfen?"
                required
              />
            </div>

            {/* Equal */}
            <div>
              <label className="block text-sm font-medium text-accent mb-2">
                Gleich lassen (Equal)
              </label>
              <textarea 
                rows={4} 
                value={reflectionData.equal}
                onChange={(e) => handleInputChange('equal', e.target.value)}
                className="w-full bg-background/50 border border-accent/30 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-accent text-foreground resize-none"
                placeholder="Welche Aspekte sind gut so?"
                required
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-center pt-6">
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="px-8 py-3 font-semibold text-white bg-accent rounded-2xl hover:bg-accent/90 disabled:bg-accent/50 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Wird gespeichert...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Reflektion speichern
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

