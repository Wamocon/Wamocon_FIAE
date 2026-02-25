'use client';

import { useDemo } from './DemoContext';
import { useRouter } from 'next/navigation';
import { GraduationCap, Users } from 'lucide-react';

export function DemoRoleSwitcher() {
  const { role, toggleRole } = useDemo();
  const router = useRouter();

  const handleSwitch = () => {
    const newRole = role === 'trainee' ? 'trainer' : 'trainee';
    toggleRole();
    router.push(`/demo/${newRole}/dashboard`);
  };

  return (
    <button
      onClick={handleSwitch}
      className="fixed bottom-6 left-6 z-[70] flex items-center gap-2 rounded-full bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 text-sm font-semibold text-white shadow-2xl transition-all duration-200 hover:scale-105 hover:shadow-red-500/25"
    >
      {role === 'trainee' ? (
        <>
          <Users className="h-4 w-4" />
          <span>Ausbilder ansehen</span>
        </>
      ) : (
        <>
          <GraduationCap className="h-4 w-4" />
          <span>Azubi ansehen</span>
        </>
      )}
    </button>
  );
}
