'use client'

import { useState } from 'react'
import { ArrowLeft, BookOpen, CheckCircle, Play, Pause, Volume2, VolumeX, Maximize2, Download, Share2 } from 'lucide-react'

interface LessonProps {
  onNavigation: (view: string, data?: any) => void
}

export function Lesson({ onNavigation }: LessonProps) {
  const [isCompleted, setIsCompleted] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleGoBack = () => {
    onNavigation('chapterDetail')
  }

  const handleComplete = () => {
    setIsCompleted(true)
    // Here you would typically save the completion status to the backend
  }

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying)
  }

  const handleMute = () => {
    setIsMuted(!isMuted)
  }

  if (isCompleted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Lektion erfolgreich abgeschlossen! 🎉</h2>
          <p className="text-muted mb-6">
            Du hast die Lektion "Variablen, Datentypen und Operatoren" erfolgreich abgeschlossen.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => onNavigation('dashboard')}
              className="px-6 py-3 font-medium text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Zum Dashboard
            </button>
            <button
              onClick={() => onNavigation('chapterDetail')}
              className="px-6 py-3 font-medium text-muted bg-muted/30 rounded-2xl hover:bg-muted/50 transition-all duration-200"
            >
              Nächste Lektion
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={handleGoBack}
            className="p-2 text-muted hover:text-foreground hover:bg-accent/20 rounded-xl transition-all duration-200"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">Variablen, Datentypen und Operatoren</h1>
            <p className="text-muted mt-1">Lektion aus dem Kapitel "Variablen und Datentypen"</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-muted/30 rounded-full h-3 mb-4">
          <div 
            className="bg-gradient-to-r from-accent to-primary h-3 rounded-full transition-all duration-500" 
            style={{ width: `${progress}%` }}
          />
        </div>
        
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Fortschritt: {progress}%</span>
          <span>Geschätzte Zeit: 15 Min.</span>
        </div>
      </div>

      {/* Video Player */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="aspect-video bg-background/50 rounded-2xl flex items-center justify-center relative overflow-hidden">
          <div className="text-center">
            <div className="w-24 h-24 bg-gradient-to-br from-accent to-primary rounded-full flex items-center justify-center mx-auto mb-4">
              <Play className="w-12 h-12 text-white" />
            </div>
            <p className="text-muted font-medium">Video wird geladen...</p>
          </div>
          
          {/* Video Controls */}
          <div className="absolute bottom-4 left-4 right-4 bg-black/50 backdrop-blur-sm rounded-2xl p-4">
            <div className="flex items-center gap-4">
              <button
                onClick={handlePlayPause}
                className="w-10 h-10 bg-white rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors duration-200"
              >
                {isPlaying ? <Pause className="w-5 h-5 text-slate-800" /> : <Play className="w-5 h-5 text-slate-800" />}
              </button>
              
              <div className="flex-1 bg-slate-300 rounded-full h-2">
                <div className="bg-white h-2 rounded-full" style={{ width: `${progress}%` }}></div>
              </div>
              
              <button
                onClick={handleMute}
                className="w-8 h-8 text-white hover:bg-white/20 rounded-lg transition-colors duration-200 flex items-center justify-center"
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              
              <button className="w-8 h-8 text-white hover:bg-white/20 rounded-lg transition-colors duration-200 flex items-center justify-center">
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lesson Content */}
      <div className="bg-white rounded-3xl p-8 shadow-lg border border-slate-200">
        <div className="prose prose-slate max-w-none">
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Was sind Variablen?</h2>
          <p className="text-slate-600 mb-6 text-lg leading-relaxed">
            Variablen sind Behälter für Daten in der Programmierung. Sie ermöglichen es uns, 
            Informationen zu speichern und später wieder zu verwenden. Eine Variable hat einen Namen 
            und kann verschiedene Arten von Daten enthalten.
          </p>
          
          <h3 className="text-xl font-bold text-slate-800 mb-4">Beispiel in JavaScript:</h3>
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 p-6 rounded-2xl border border-slate-200 mb-6">
            <code className="text-slate-800 font-mono text-sm leading-relaxed">
              <span className="text-blue-600">let</span> <span className="text-green-600">name</span> = <span className="text-orange-600">"Elias"</span>;<br/>
              <span className="text-blue-600">let</span> <span className="text-green-600">age</span> = <span className="text-purple-600">18</span>;<br/>
              <span className="text-blue-600">let</span> <span className="text-green-600">isStudent</span> = <span className="text-red-600">true</span>;
            </code>
          </div>
          
          <h3 className="text-xl font-bold text-slate-800 mb-4">Datentypen:</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-slate-700"><strong>String:</strong> Text (z.B. "Hello World")</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-slate-700"><strong>Number:</strong> Zahlen (z.B. 42, 3.14)</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                <span className="text-slate-700"><strong>Boolean:</strong> Wahrheitswerte (true/false)</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                <span className="text-slate-700"><strong>Array:</strong> Listen von Werten</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span className="text-slate-700"><strong>Object:</strong> Sammlung von Eigenschaften</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-3 h-3 bg-indigo-500 rounded-full"></div>
                <span className="text-slate-700"><strong>Undefined:</strong> Nicht definierter Wert</span>
              </div>
            </div>
          </div>
          
          <h3 className="text-xl font-bold text-slate-800 mb-4">Operatoren:</h3>
          <p className="text-slate-600 mb-6 text-lg leading-relaxed">
            Operatoren sind Symbole, die Operationen auf Variablen und Werten ausführen. 
            Sie ermöglichen es uns, Berechnungen durchzuführen und Vergleiche anzustellen.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-2xl border border-blue-200">
              <h4 className="font-semibold text-blue-800 mb-4 flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                Arithmetische Operatoren:
              </h4>
              <div className="space-y-2 text-sm text-blue-700">
                <div className="flex items-center justify-between">
                  <span>+ (Addition)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">5 + 3 = 8</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>- (Subtraktion)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">10 - 4 = 6</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>* (Multiplikation)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">6 * 7 = 42</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>/ (Division)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">15 / 3 = 5</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>% (Modulo)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">17 % 5 = 2</code>
                </div>
              </div>
            </div>
            
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-6 rounded-2xl border border-green-200">
              <h4 className="font-semibold text-green-800 mb-4 flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                Vergleichsoperatoren:
              </h4>
              <div className="space-y-2 text-sm text-green-700">
                <div className="flex items-center justify-between">
                  <span>== (Gleichheit)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">5 == "5"</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>=== (Strikte Gleichheit)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">5 === 5</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>!= (Ungleichheit)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">5 != 3</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>&gt; (Größer als)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">10 &gt; 5</code>
                </div>
                <div className="flex items-center justify-between">
                  <span>&lt; (Kleiner als)</span>
                  <code className="bg-white px-2 py-1 rounded text-xs">3 &lt; 7</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-3xl p-6 shadow-lg border border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-all duration-200 flex items-center gap-2">
              <Download className="w-4 h-4" />
              Material herunterladen
            </button>
            <button className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-all duration-200 flex items-center gap-2">
              <Share2 className="w-4 h-4" />
              Teilen
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleGoBack}
              className="px-6 py-3 font-medium text-slate-600 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-all duration-200 flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Zurück zum Kapitel
            </button>
            
            <button
              onClick={handleComplete}
              className="px-8 py-3 font-semibold text-white bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center gap-2"
            >
              <CheckCircle className="w-5 h-5" />
              Lektion abgeschlossen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
