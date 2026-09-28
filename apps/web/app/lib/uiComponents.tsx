/**
 * UI Component Utilities - Reusable React components for consistent UI
 */

import React from 'react';

// Button Component - Multiple variants and sizes
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      children,
      isLoading = false,
      icon,
      className = '',
      ...props
    },
    ref
  ) => {
    const variantStyles = {
      primary:
        'bg-primary text-primary-foreground hover:opacity-90 shadow-md shadow-primary/20 hover:shadow-lg active:shadow-inner',
      secondary:
        'bg-input text-slate-100 hover:bg-input border border-input',
      outline: 'border-2 border-primary text-primary hover:bg-primary/10',
      ghost: 'text-slate-300 hover:bg-input/50 hover:text-slate-100',
    };

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm gap-2',
      md: 'px-4 py-2 text-base gap-2',
      lg: 'px-6 py-3 text-lg gap-3',
    };

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading ? (
          <svg
            className="w-4 h-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : icon ? (
          icon
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

// Badge Component - For labels and status indicators
interface BadgeProps {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
}) => {
  const variantStyles = {
    primary: 'bg-primary/20 text-primary border border-primary/30',
    secondary: 'bg-input/70 text-slate-200 border border-input/40',
    success: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    error: 'bg-red-500/20 text-red-300 border border-red-500/30',
  };

  const sizeStyles = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </span>
  );
};

// Card Component - Container for content sections
interface CardProps {
  children: React.ReactNode;
  className?: string;
  withPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  withPadding = true,
}) => {
  return (
    <div
      className={`bg-secondary/50 border border-border rounded-lg backdrop-blur-sm transition-all duration-200 hover:border-input hover:bg-secondary/70 ${withPadding ? 'p-4' : ''} ${className}`}
    >
      {children}
    </div>
  );
};

// Tooltip Component - For informational hints
interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
}) => {
  const positionStyles = {
    top: 'bottom-full mb-2 -translate-x-1/2 left-1/2',
    bottom: 'top-full mt-2 -translate-x-1/2 left-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  };

  return (
    <div className="relative group inline-block">
      {children}
      <div
        className={`absolute ${positionStyles[position]} hidden group-hover:block z-50 px-3 py-2 bg-card text-slate-100 text-xs rounded-md whitespace-nowrap shadow-lg border border-border pointer-events-none`}
      >
        {content}
        <div
          className={`absolute w-2 h-2 bg-card border-l border-t border-border ${
            position === 'top'
              ? 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45'
              : position === 'bottom'
                ? 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45'
                : position === 'left'
                  ? 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rotate-45'
                  : 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 rotate-45'
          }`}
        />
      </div>
    </div>
  );
};

// Divider Component
export const Divider: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`border-t border-border ${className}`} />
);

// Icon Button Component - For toolbar and action buttons
interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, size = 'md', className = '', ...props }, ref) => {
    const sizeStyles = {
      sm: 'w-8 h-8 p-1.5',
      md: 'w-10 h-10 p-2',
      lg: 'w-12 h-12 p-2.5',
    };

    return (
      <Tooltip content={label || ''}>
        <button
          ref={ref}
          className={`inline-flex items-center justify-center rounded-lg transition-all duration-200 text-slate-300 hover:text-white hover:bg-input/50 focus:outline-none focus:ring-2 focus:ring-primary/50 ${sizeStyles[size]} ${className}`}
          {...props}
        >
          {icon}
        </button>
      </Tooltip>
    );
  }
);
IconButton.displayName = 'IconButton';

// Section Header Component
interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  description,
  action,
}) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
      {description && (
        <p className="text-sm text-slate-400 mt-1">{description}</p>
      )}
    </div>
    {action && <div>{action}</div>}
  </div>
);

// Loading Skeleton Component
interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = 'w-full',
  height = 'h-4',
  className = '',
}) => (
  <div
    className={`${width} ${height} bg-gradient-to-r from-slate-700 to-slate-600 rounded-md animate-pulse ${className}`}
  />
);
