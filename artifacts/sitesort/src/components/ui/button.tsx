import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "accent";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", isLoading, children, ...props }, ref) => {
    
    const variants = {
      default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-black/5 hover:-translate-y-0.5",
      accent: "bg-accent text-accent-foreground hover:bg-accent/90 shadow-md shadow-accent/20 hover:-translate-y-0.5 font-semibold",
      destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
      outline: "border-2 border-input bg-background hover:bg-muted hover:text-foreground",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      ghost: "hover:bg-muted hover:text-foreground",
      link: "text-primary underline-offset-4 hover:underline",
    };

    const sizes = {
      default: "h-11 px-5 py-2",
      sm: "h-9 rounded-md px-3 text-xs",
      lg: "h-14 rounded-xl px-8 text-lg font-semibold",
      icon: "h-11 w-11",
    };

    return (
      <button
        ref={ref}
        disabled={isLoading || props.disabled}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
