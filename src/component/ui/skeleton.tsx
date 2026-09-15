import type * as React from "react";

import { cn } from "@/lib/utils";

type SkeletonProps = {
  className?: string;
};

const Skeleton = ({ className }: SkeletonProps): React.JSX.Element => (
  <div data-slot="skeleton" className={cn("bg-muted animate-pulse rounded-md", className)} />
);

export { Skeleton };
