'use client'

import ModuleDetail from '@/components/learning/ModuleDetail'

export default async function ModuleDetailPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params
  return <ModuleDetail moduleId={moduleId} />
}
