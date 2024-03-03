import React from "react";
import { PlateLeaf, type PlateLeafProps } from "@udecode/plate-common";
import { cn } from "~/utils";

const BoldLeaf = React.forwardRef<
  // @ts-expect-error ⚠️ 1.2.5
  React.ElementRef<typeof PlateLeaf>,
  PlateLeafProps
>(({ className, children, ...props }: PlateLeafProps, ref) => {
  return (
    <PlateLeaf
      ref={ref}
      className={cn("text-primary", className)}
      asChild
      {...props}
    >
      <strong>{children}</strong>
    </PlateLeaf>
  );
});

BoldLeaf.displayName = "BoldLeaf";

export { BoldLeaf };
