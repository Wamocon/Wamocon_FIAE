'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Download,
  Share2,
} from 'lucide-react';

interface LessonProps {
  lessonId: string;
}

export default function Lesson({ lessonId }: LessonProps) {
  const router = useRouter();
  const [isCompleted, setIsCompleted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleGoBack = () => {
    router.push('/trainee/modules');
  };

  const handleComplete = () => {
    setIsCompleted(true);
    // Here you would typically save the completion status to the backend
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleMute = () => {
    setIsMuted(!isMuted);
  };

  if (isCompleted) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 text-center shadow-lg">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-500">
            <CheckCircle className="h-10 w-10 text-white" />
          </div>
          <h2 className="text-foreground mb-2 text-2xl font-bold">
            Lektion erfolgreich abgeschlossen! 🎉
          </h2>
          <p className="text-muted mb-6">
            Du hast die Lektion "Variablen, Datentypen und Operatoren"
            erfolgreich abgeschlossen.
          </p>

          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              onClick={() => router.push('/trainee/dashboard')}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              Zum Dashboard
            </button>
            <button
              onClick={() => router.push('/trainee/modules')}
              className="text-muted bg-muted/30 hover:bg-muted/50 rounded-2xl px-6 py-3 font-medium transition-all duration-200"
            >
              Nächste Lektion
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={handleGoBack}
            className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-foreground text-3xl font-bold">
              Variablen, Datentypen und Operatoren
            </h1>
            <p className="text-muted mt-1">
              Lektion aus dem Kapitel "Variablen und Datentypen"
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-muted/30 mb-4 h-3 w-full rounded-full">
          <div
            className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="text-muted flex items-center justify-between text-sm">
          <span>Fortschritt: {progress}%</span>
          <span>Geschätzte Zeit: 15 Min.</span>
        </div>
      </div>

      {/* Video Player */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="bg-background/50 relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl">
          <div className="text-center">
            <div className="from-accent to-primary mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br">
              <Play className="h-12 w-12 text-white" />
            </div>
            <p className="text-muted font-medium">Video wird geladen...</p>
          </div>

          {/* Video Controls */}
          <div className="absolute right-4 bottom-4 left-4 rounded-2xl bg-black/50 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-4">
              <button
                onClick={handlePlayPause}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white transition-colors duration-200 hover:bg-slate-100"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5 text-slate-800" />
                ) : (
                  <Play className="h-5 w-5 text-slate-800" />
                )}
              </button>

              <div className="h-2 flex-1 rounded-full bg-slate-300">
                <div
                  className="h-2 rounded-full bg-white"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>

              <button
                onClick={handleMute}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white transition-colors duration-200 hover:bg-white/20"
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>

              <button className="flex h-8 w-8 items-center justify-center rounded-lg text-white transition-colors duration-200 hover:bg-white/20">
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lesson Content */}
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="prose prose-slate max-w-none">
          <h2 className="mb-4 text-2xl font-bold text-slate-800">
            Was sind Variablen?
          </h2>
          <p className="mb-6 text-lg leading-relaxed text-slate-600">
            Variablen sind Behälter für Daten in der Programmierung. Sie
            ermöglichen es uns, Informationen zu speichern und später wieder zu
            verwenden. Eine Variable hat einen Namen und kann verschiedene Arten
            von Daten enthalten.
          </p>

          <h3 className="mb-4 text-xl font-bold text-slate-800">
            Beispiel in JavaScript:
          </h3>
          <div className="mb-6 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50 p-6">
            <code className="font-mono text-sm leading-relaxed text-slate-800">
              <span className="text-blue-600">let</span>{' '}
              <span className="text-green-600">name</span> ={' '}
              <span className="text-orange-600">"Elias"</span>;<br />
              <span className="text-blue-600">let</span>{' '}
              <span className="text-green-600">age</span> ={' '}
              <span className="text-purple-600">18</span>;<br />
              <span className="text-blue-600">let</span>{' '}
              <span className="text-green-600">isStudent</span> ={' '}
              <span className="text-red-600">true</span>;
            </code>
          </div>

          <h3 className="mb-4 text-xl font-bold text-slate-800">Datentypen:</h3>
          <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                <span className="text-slate-700">
                  <strong>String:</strong> Text (z.B. "Hello World")
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="h-3 w-3 rounded-full bg-green-500"></div>
                <span className="text-slate-700">
                  <strong>Number:</strong> Zahlen (z.B. 42, 3.14)
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="h-3 w-3 rounded-full bg-purple-500"></div>
                <span className="text-slate-700">
                  <strong>Boolean:</strong> Wahrheitswerte (true/false)
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="h-3 w-3 rounded-full bg-orange-500"></div>
                <span className="text-slate-700">
                  <strong>Array:</strong> Listen von Werten
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="h-3 w-3 rounded-full bg-red-500"></div>
                <span className="text-slate-700">
                  <strong>Object:</strong> Sammlung von Eigenschaften
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="h-3 w-3 rounded-full bg-indigo-500"></div>
                <span className="text-slate-700">
                  <strong>Undefined:</strong> Nicht definierter Wert
                </span>
              </div>
            </div>
          </div>

          <h3 className="mb-4 text-xl font-bold text-slate-800">Operatoren:</h3>
          <p className="mb-6 text-lg leading-relaxed text-slate-600">
            Operatoren sind Symbole, die Operationen auf Variablen und Werten
            ausführen. Sie ermöglichen es uns, Berechnungen durchzuführen und
            Vergleiche anzustellen.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
              <h4 className="mb-4 flex items-center gap-2 font-semibold text-blue-800">
                <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                Arithmetische Operatoren:
              </h4>
              <div className="space-y-2 text-sm text-blue-700">
                <div className="flex items-center justify-between">
                  <span>+ (Addition)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    5 + 3 = 8
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>- (Subtraktion)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    10 - 4 = 6
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>* (Multiplikation)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    6 * 7 = 42
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>/ (Division)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    15 / 3 = 5
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>% (Modulo)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    17 % 5 = 2
                  </code>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6">
              <h4 className="mb-4 flex items-center gap-2 font-semibold text-green-800">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                Vergleichsoperatoren:
              </h4>
              <div className="space-y-2 text-sm text-green-700">
                <div className="flex items-center justify-between">
                  <span>== (Gleichheit)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    5 == "5"
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>=== (Strikte Gleichheit)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    5 === 5
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>!= (Ungleichheit)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    5 != 3
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>&gt; (Größer als)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    10 &gt; 5
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span>&lt; (Kleiner als)</span>
                  <code className="rounded bg-white px-2 py-1 text-xs">
                    3 &lt; 7
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-slate-600 transition-all duration-200 hover:bg-slate-200">
              <Download className="h-4 w-4" />
              Material herunterladen
            </button>
            <button className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-slate-600 transition-all duration-200 hover:bg-slate-200">
              <Share2 className="h-4 w-4" />
              Teilen
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleGoBack}
              className="flex items-center gap-2 rounded-2xl bg-slate-100 px-6 py-3 font-medium text-slate-600 transition-all duration-200 hover:bg-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Zurück zum Kapitel
            </button>

            <button
              onClick={handleComplete}
              className="flex transform items-center gap-2 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 px-8 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:from-green-700 hover:to-emerald-700 hover:shadow-xl"
            >
              <CheckCircle className="h-5 w-5" />
              Lektion abgeschlossen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
