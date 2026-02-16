'use client';

import { ChevronRight, Home } from 'lucide-react';
import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  return (
    <nav
      className={`flex items-center space-x-2 text-sm ${className}`}
      aria-label="Breadcrumb"
    >
      <Link
        prefetch
        href="/"
        className="text-muted-foreground hover:text-foreground flex items-center transition-colors"
      >
        <Home className="mr-1 h-4 w-4" />
        Dashboard
      </Link>

      {items.map((item, index) => (
        <div key={index} className="flex items-center space-x-2">
          <ChevronRight className="text-muted-foreground h-4 w-4" />
          {item.href ? (
            <Link
              prefetch={false}
              href={item.href}
              className="text-muted-foreground hover:text-foreground flex items-center transition-colors"
            >
              {item.icon && <span className="mr-1">{item.icon}</span>}
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground flex items-center">
              {item.icon && <span className="mr-1">{item.icon}</span>}
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}
