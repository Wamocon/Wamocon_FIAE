'use client'

import { useRouter } from 'next/navigation'
import { Award, Calendar, ArrowRight, Play, BookOpen, Target, TrendingUp, Clock, BarChart3, PieChart } from 'lucide-react'
import { mockData } from '@/lib/supabase'
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RechartsPieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts'

export default function TraineeDashboard() {
  const router = useRouter()
  
  // Use mock data from supabase
  const nextLesson = {
    id: 'les_1_2_1',
    title: 'Variablen, Datentypen und Operatoren',
    module: 'Variablen und Datentypen',
    estimatedTime: '45 min'
  }

  const modules = mockData.curriculum

  // Chart data
  const weeklyProgress = [
    { week: 'W1', progress: 15 },
    { week: 'W2', progress: 28 },
    { week: 'W3', progress: 42 },
    { week: 'W4', progress: 55 },
    { week: 'W5', progress: 68 },
    { week: 'W6', progress: 75 }
  ]

  const skillRadar = [
    { skill: 'HTML/CSS', value: 85 },
    { skill: 'JavaScript', value: 72 },
    { skill: 'React', value: 68 },
    { skill: 'Node.js', value: 45 },
    { skill: 'Datenbanken', value: 78 },
    { skill: 'Git', value: 82 }
  ]

  const moduleProgress = modules.map(module => ({
    name: module.title.length > 20 ? module.title.substring(0, 20) + '...' : module.title,
    progress: module.progress,
    color: module.progress > 70 ? '#ef4444' : module.progress > 40 ? '#dc2626' : '#3c2846'
  }))

  const handleModuleClick = (moduleId: string) => {
    router.push(`/trainee/modules/${moduleId}`)
  }

  const handleLessonClick = (lessonId: string) => {
    router.push(`/trainee/lessons/${lessonId}`)
  }

  const handleNavigation = (view: string, data?: any) => {
    switch (view) {
      case 'modules':
        if (data?.moduleId) {
          router.push(`/trainee/modules/${data.moduleId}`)
        } else {
          router.push('/trainee/modules')
        }
        break
      case 'lessons':
        if (data?.lessonId) {
          router.push(`/trainee/lessons/${data.lessonId}`)
        } else {
          router.push('/trainee/lessons')
        }
        break
      case 'quizzes':
        if (data?.quizId) {
          router.push(`/trainee/quizzes/${data.quizId}`)
        } else {
          router.push('/trainee/quizzes')
        }
        break
      case 'knowledgeSubmission':
        router.push('/trainee/knowledge-submission')
        break
      case 'reflection':
        router.push('/trainee/reflection')
        break
      case 'dashboard':
        router.push('/trainee/dashboard')
        break
      default:
        console.log('Navigation:', view, data)
    }
  }

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-background via-red-900/30 to-red-800/40 min-h-screen relative">
      {/* Enhanced red background overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25 pointer-events-none rounded-3xl"></div>
      <div className="relative z-10">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Continue Learning Card */}
          <div 
            className="glass-effect-enhanced p-6 rounded-2xl shadow-2xl border-2 border-accent/40 cursor-pointer hover:border-accent/70 hover:shadow-accent/20 transition-all duration-300 transform hover:-translate-y-1"
            onClick={() => handleLessonClick(nextLesson.id)}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-accent mb-3 tracking-wider uppercase">WEITERMACHEN</h3>
                <p className="text-2xl font-bold text-foreground leading-tight">{nextLesson.title}</p>
                <p className="text-muted-foreground mt-2">Modul: {nextLesson.module}</p>
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center shadow-lg">
                <Play className="w-8 h-8 text-white" />
              </div>
            </div>
            <div className="flex items-center mt-4 text-accent">
              <Clock className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">{nextLesson.estimatedTime}</span>
            </div>
          </div>

          {/* Learning Path Section - Textual Information Above Charts */}
          <div className="glass-effect-enhanced p-6 rounded-2xl shadow-2xl border-2 border-accent/30">
            <h3 className="text-xl font-bold text-foreground mb-6 flex items-center">
              <div className="w-10 h-10 bg-gradient-to-br from-accent to-primary rounded-xl flex items-center justify-center mr-4">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              Mein Lernpfad
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {modules.map((module) => (
                <div
                  key={module.moduleId}
                  className="bg-gradient-to-br from-background/80 to-red-900/10 p-5 rounded-xl shadow-lg hover:shadow-xl hover:from-background/90 hover:to-red-900/20 transition-all duration-300 cursor-pointer border border-accent/20 hover:border-accent/40 group"
                  onClick={() => handleModuleClick(module.moduleId)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-lg text-foreground group-hover:text-accent transition-colors">{module.title}</h3>
                    <ArrowRight className="w-5 h-5 text-accent/60 group-hover:text-accent transition-colors" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">Fortschritt</p>
                  <div className="w-full bg-muted/50 rounded-full h-3 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-accent to-primary h-3 rounded-full transition-all duration-700 shadow-lg" 
                      style={{ width: `${module.progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-muted-foreground">0% → {module.progress}%</span>
                    <span className="text-lg font-bold text-accent">{module.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Achievements Section - Textual Information Above Charts */}
          <div className="glass-effect p-6 rounded-2xl shadow-lg border border-accent/20">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-500 to-orange-500 rounded-lg flex items-center justify-center mr-3">
                <Award className="w-4 h-4 text-white" />
              </div>
              Letzte Erfolge
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-background/60 to-red-900/10 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors">
                <span className="text-foreground font-medium">90% im Quiz "Grundbegriffe"</span>
                <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
                  <Award className="w-4 h-4 text-accent" />
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-background/60 to-red-900/10 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors">
                <span className="text-foreground font-medium">Modul "HTML/CSS" abgeschlossen</span>
                <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-green-400" />
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-background/60 to-red-900/10 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors">
                <span className="text-foreground font-medium">7 Tage in Folge gelernt</span>
                <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Upcoming Deadlines Section - Textual Information Above Charts */}
          <div className="glass-effect p-6 rounded-2xl shadow-lg border border-accent/20">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-pink-500 rounded-lg flex items-center justify-center mr-3">
                <Calendar className="w-4 h-4 text-white" />
              </div>
              Anstehende Termine
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-background/60 to-red-900/10 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors">
                <span className="text-foreground font-medium">Reflektion Q3: 30.09.2025</span>
                <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-purple-400" />
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-background/60 to-red-900/10 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors">
                <span className="text-foreground font-medium">Quiz "JavaScript": 25.08.2025</span>
                <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
                  <Target className="w-4 h-4 text-accent" />
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-background/60 to-red-900/10 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors">
                <span className="text-foreground font-medium">Projektabgabe: 15.09.2025</span>
                <div className="w-8 h-8 bg-orange-500/20 rounded-full flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-orange-400" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Charts */}
        <div className="space-y-6">
          {/* Weekly Progress Chart */}
          <div className="glass-effect-enhanced p-6 rounded-2xl shadow-2xl border-2 border-accent/30">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <div className="w-8 h-8 bg-gradient-to-br from-accent to-primary rounded-lg flex items-center justify-center mr-3">
                <BarChart3 className="w-4 h-4 text-white" />
              </div>
              Wöchentlicher Fortschritt
            </h3>
            <ResponsiveContainer width="100%" height={200} className="bg-gradient-to-br from-background/40 to-red-900/10 rounded-xl p-2">
              <LineChart data={weeklyProgress}>
                <CartesianGrid strokeDasharray="3 3" stroke="#6b7280" strokeOpacity={0.2} />
                <XAxis 
                  dataKey="week" 
                  stroke="#ffffff"
                  fontSize={12}
                  tick={{ fill: '#ffffff' }}
                />
                <YAxis 
                  stroke="#ffffff"
                  fontSize={12}
                  tick={{ fill: '#ffffff' }}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e1423',
                    border: '2px solid #ff1a1a',
                    borderRadius: '12px',
                    color: '#ffffff',
                    boxShadow: '0 8px 24px rgba(255, 26, 26, 0.3)'
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="progress" 
                  stroke="#ff1a1a" 
                  strokeWidth={4}
                  dot={{ fill: '#ff1a1a', strokeWidth: 3, r: 6, stroke: '#ffffff' }}
                  activeDot={{ r: 8, stroke: '#ffffff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
            {/* Compact data display */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {weeklyProgress.map((item, index) => (
                <div key={index} className="text-center p-2 bg-gradient-to-br from-accent/20 to-primary/20 rounded-lg border border-accent/30">
                  <div className="font-bold text-accent text-sm">{item.week}</div>
                  <div className="text-foreground font-semibold">{item.progress}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* Skills Radar Chart */}
          <div className="glass-effect-enhanced p-6 rounded-2xl shadow-2xl border-2 border-accent/30">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center mr-3">
                <Target className="w-4 h-4 text-white" />
              </div>
              Fähigkeiten
            </h3>
            <ResponsiveContainer width="100%" height={200} className="bg-gradient-to-br from-background/40 to-green-900/10 rounded-xl p-2">
              <RadarChart data={skillRadar}>
                <PolarGrid stroke="#6b7280" strokeOpacity={0.2} />
                <PolarAngleAxis 
                  dataKey="skill" 
                  stroke="#ffffff"
                  fontSize={11}
                  tick={{ fill: '#ffffff' }}
                />
                <PolarRadiusAxis 
                  stroke="#ffffff"
                  fontSize={10}
                  tick={{ fill: '#ffffff' }}
                  axisLine={false}
                />
                <Radar 
                  name="Skills" 
                  dataKey="value" 
                  stroke="#ff1a1a" 
                  fill="#ff1a1a" 
                  fillOpacity={0.3}
                  strokeWidth={3}
                />
              </RadarChart>
            </ResponsiveContainer>
            {/* Compact skills display */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {skillRadar.map((item, index) => (
                <div key={index} className="text-center p-2 bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-lg border border-green-500/30">
                  <div className="font-bold text-green-400 text-xs">{item.skill}</div>
                  <div className="text-foreground font-semibold text-sm">{item.value}/100</div>
                </div>
              ))}
            </div>
          </div>

          {/* Module Progress Chart */}
          <div className="glass-effect-enhanced p-6 rounded-2xl shadow-2xl border-2 border-accent/30">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center mr-3">
                <PieChart className="w-4 h-4 text-white" />
              </div>
              Modul-Fortschritt
            </h3>
            <ResponsiveContainer width="100%" height={200} className="bg-gradient-to-br from-background/40 to-blue-900/10 rounded-xl p-2">
              <BarChart data={moduleProgress}>
                <CartesianGrid strokeDasharray="3 3" stroke="#6b7280" strokeOpacity={0.2} />
                <XAxis 
                  dataKey="name" 
                  stroke="#ffffff"
                  fontSize={10}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  tick={{ fill: '#ffffff' }}
                />
                <YAxis 
                  stroke="#ffffff"
                  fontSize={10}
                  tick={{ fill: '#ffffff' }}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e1423',
                    border: '2px solid #ff1a1a',
                    borderRadius: '12px',
                    color: '#ffffff',
                    boxShadow: '0 8px 24px rgba(255, 26, 26, 0.3)'
                  }}
                />
                <Bar 
                  dataKey="progress" 
                  fill="#ff1a1a"
                  radius={[4, 4, 0, 0]}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
              </BarChart>
            </ResponsiveContainer>
            {/* Compact module progress display */}
            <div className="mt-4 space-y-2">
              {moduleProgress.map((item, index) => (
                <div key={index} className="flex justify-between items-center p-2 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-lg border border-blue-500/30">
                  <span className="text-foreground font-medium text-xs truncate flex-1 mr-2">{item.name}</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-16 bg-blue-500/30 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-accent to-primary h-2 rounded-full shadow-lg" 
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    <span className="text-accent font-bold text-sm min-w-[2.5rem] text-right">{item.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
