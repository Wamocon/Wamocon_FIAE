'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { 
  Upload, 
  FileText, 
  Send, 
  CheckCircle, 
  AlertCircle,
  BookOpen,
  Clock,
  Award
} from 'lucide-react'

export function KnowledgeSubmission() {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionStatus, setSubmissionStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000))
      setSubmissionStatus('success')
      setTitle('')
      setContent('')
      setFiles([])
    } catch (error) {
      setSubmissionStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto"></div>
          <p className="mt-4 text-muted">Lade...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30 text-center">
          <h1 className="text-4xl font-bold text-foreground mb-4">Wissenseinreichung</h1>
          <p className="text-muted text-lg">
            Teilen Sie Ihr Wissen und Ihre Erfahrungen mit der Community
          </p>
        </div>

        {/* Submission Form */}
        <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
          <h2 className="text-2xl font-bold text-foreground mb-6">Neue Einreichung</h2>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-muted mb-2">
                Titel der Einreichung
              </label>
              <input
                id="title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground placeholder-muted resize-none"
                placeholder="Geben Sie einen aussagekräftigen Titel ein..."
              />
            </div>

            <div>
              <label htmlFor="content" className="block text-sm font-medium text-muted mb-2">
                Inhalt
              </label>
              <textarea
                id="content"
                required
                rows={8}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground placeholder-muted resize-none"
                placeholder="Beschreiben Sie Ihr Wissen, Ihre Erfahrungen oder Erkenntnisse..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-2">
                Dateien anhängen (optional)
              </label>
              <div className="border-2 border-dashed border-accent/30 rounded-2xl p-8 text-center hover:border-accent/50 transition-colors">
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <Upload className="w-12 h-12 text-accent mx-auto mb-4" />
                  <p className="text-muted mb-2">
                    Klicken Sie hier, um Dateien auszuwählen
                  </p>
                  <p className="text-sm text-muted">
                    Oder ziehen Sie Dateien hierher
                  </p>
                </label>
              </div>
              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-background/50 rounded-xl border border-accent/30">
                      <FileText className="w-5 h-5 text-accent" />
                      <span className="text-muted text-sm">{file.name}</span>
                      <span className="text-muted text-xs ml-auto">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 font-semibold text-foreground bg-accent rounded-2xl hover:bg-accent/90 disabled:bg-accent/50 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-accent flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-foreground"></div>
                  Wird eingereicht...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Einreichung senden
                </>
              )}
            </button>
          </form>

          {/* Submission Status */}
          {submissionStatus === 'success' && (
            <div className="mt-6 p-4 bg-green-900/20 border border-green-700 rounded-2xl">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-green-400" />
                <div>
                  <p className="text-green-400 font-medium">Einreichung erfolgreich!</p>
                  <p className="text-green-300 text-sm">
                    Ihre Wissenseinreichung wurde erfolgreich gesendet und wird von unserem Team geprüft.
                  </p>
                </div>
              </div>
            </div>
          )}

          {submissionStatus === 'error' && (
            <div className="mt-6 p-4 bg-red-900/20 border border-red-700 rounded-2xl">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-6 h-6 text-red-400" />
                <div>
                  <p className="text-red-400 font-medium">Fehler bei der Einreichung</p>
                  <p className="text-red-300 text-sm">
                    Es gab ein Problem beim Senden Ihrer Einreichung. Bitte versuchen Sie es erneut.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Guidelines */}
        <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
          <h2 className="text-2xl font-bold text-foreground mb-6">Richtlinien für Wissenseinreichungen</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <BookOpen className="w-12 h-12 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Relevanz</h3>
              <p className="text-muted text-sm">
                Stellen Sie sicher, dass Ihr Beitrag für die Ausbildung relevant ist.
              </p>
            </div>
            <div className="text-center">
              <Clock className="w-12 h-12 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Aktualität</h3>
              <p className="text-muted text-sm">
                Teilen Sie aktuelle Erkenntnisse und moderne Praktiken.
              </p>
            </div>
            <div className="text-center">
              <Award className="w-12 h-12 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Qualität</h3>
              <p className="text-muted text-sm">
                Bieten Sie detaillierte und nützliche Informationen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

