import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B5E99] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 shrink-0 cursor-pointer active:scale-[0.99]',
  {
    variants: {
      variant: {
        default: 'bg-[#0B1B3A] text-white hover:bg-[#13284F] shadow-xs',
        accent: 'bg-[#1B5E99] text-white hover:bg-[#154C7E] shadow-xs',
        gold: 'bg-[#D9AA32] text-[#0B1B3A] font-semibold hover:bg-[#C69722] shadow-xs',
        outline:
          'border border-slate-200/90 bg-white text-[#0B1B3A] hover:bg-[#F4F7FB] hover:border-slate-300',
        ghost: 'text-slate-700 hover:bg-[#EBF3FA] hover:text-[#0B1B3A]',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        default: 'min-h-[44px] md:min-h-[40px] px-4 py-2',
        sm: 'min-h-[40px] md:min-h-[34px] px-3 py-1.5 text-xs',
        lg: 'min-h-[48px] px-6 py-2.5',
        icon: 'h-11 w-11 md:h-9 md:w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-slate-200/85 bg-white text-[#0B1B3A] shadow-[0_1px_2px_rgba(11,27,58,0.03)] overflow-hidden',
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1 p-4 sm:p-5 border-b border-slate-100', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-sm sm:text-base font-semibold tracking-tight text-[#0B1B3A]', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-4 sm:p-5', className)} {...props} />
));
CardContent.displayName = 'CardContent';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex min-h-[44px] md:min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base md:text-sm text-[#0B1B3A] placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B5E99] focus-visible:border-[#1B5E99] disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
      className
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex min-h-[88px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base md:text-sm text-[#0B1B3A] placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B5E99] focus-visible:border-[#1B5E99] disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
      className
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('block text-xs font-semibold text-slate-700 leading-tight', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex min-h-[44px] md:min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base md:text-sm text-[#0B1B3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B5E99] focus-visible:border-[#1B5E99] disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const dialogSizeClasses = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-4xl',
  '2xl': 'sm:max-w-5xl',
} as const;

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: keyof typeof dialogSizeClasses;
  structured?: boolean;
}

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size, structured = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0B1B3A]/60 backdrop-blur-[2px]" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 bg-white border border-slate-200/90 shadow-2xl focus:outline-none',
        structured
          ? 'bottom-0 left-0 right-0 w-full max-h-[92dvh] rounded-t-2xl flex flex-col overflow-hidden p-0 sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:right-auto sm:w-[95vw] sm:max-h-[88vh] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl'
          : 'bottom-0 left-0 right-0 w-full max-h-[92dvh] rounded-t-2xl overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:right-auto sm:w-[95vw] sm:max-h-[90vh] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:p-6',
        size ? dialogSizeClasses[size] : 'sm:max-w-2xl',
        className
      )}
      {...props}
    >
      {!structured && (
        <div
          className="w-10 h-1 rounded-full bg-slate-300 mx-auto mb-3 sm:hidden"
          aria-hidden="true"
        />
      )}
      {children}
      <DialogPrimitive.Close
        aria-label="Tutup dialog"
        className="absolute right-3.5 top-3.5 sm:right-5 sm:top-4 min-h-[38px] min-w-[38px] sm:min-h-[34px] sm:min-w-[34px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-[#EBF3FA] hover:text-[#0B1B3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B5E99] cursor-pointer z-10 transition-colors"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({
  className,
  structured = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { structured?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col space-y-1',
        structured
          ? 'shrink-0 border-b border-slate-100 bg-white px-5 pt-4 pb-3.5 sm:px-6 sm:pt-5 sm:pb-4 pr-14'
          : 'mb-4 pr-8',
        className
      )}
      {...props}
    />
  );
}

export function DialogBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5 space-y-5 bg-white',
        className
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'shrink-0 border-t border-slate-200/85 bg-slate-50/95 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3',
        className
      )}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base sm:text-lg font-bold tracking-tight text-[#0B1B3A]', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs sm:text-sm text-slate-500 leading-relaxed', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'flex flex-nowrap overflow-x-auto no-scrollbar max-w-full sm:inline-flex sm:flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 bg-[#EBF3FA]/80 p-1 text-slate-600',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap shrink-0 rounded-lg px-3.5 py-2 md:py-1.5 min-h-[38px] md:min-h-[34px] text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B5E99] data-[state=active]:bg-[#0B1B3A] data-[state=active]:text-white data-[state=active]:shadow-xs cursor-pointer hover:text-[#0B1B3A]',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-4 focus:outline-none', className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export function StatusLabel({
  status,
  tone = 'neutral',
}: {
  status: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: 'text-slate-700 bg-slate-100 border-slate-200',
    success: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    warning: 'text-[#8F670D] bg-[#FDF7E3] border-[#EED58B]',
    danger: 'text-red-800 bg-red-50 border-red-200',
    info: 'text-[#154C7E] bg-[#EBF3FA] border-[#BFD9EF]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap',
        toneClasses[tone]
      )}
    >
      {status}
    </span>
  );
}
