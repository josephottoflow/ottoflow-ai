import * as React from "react";
import { cn } from "@/lib/utils";

const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-xs font-medium text-white/65 mb-1.5 block tracking-wide",
      className
    )}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };
