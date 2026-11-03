import { useState } from "react";
import { Plane } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** The deployment's public identity; URL parameters never choose a tenant. */
export function BrandIdentity({
  className,
  logoClassName,
}: {
  className?: string;
  logoClassName?: string;
}) {
  const { data } = trpc.ibePublic.config.useQuery(undefined, {
    staleTime: 300_000,
    retry: false,
  });
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const logo = data?.logoPath;
  return (
    <span
      className={cn("inline-flex items-center gap-2 font-semibold", className)}
      data-testid="brand-identity"
    >
      {logo && logo !== failedLogo ? (
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          className={cn("h-9 w-9 object-contain", logoClassName)}
          onError={() => setFailedLogo(logo)}
        />
      ) : (
        <Plane className={cn("h-7 w-7", logoClassName)} aria-hidden="true" />
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {data?.brandName ?? "AIS"}
      </span>
    </span>
  );
}
