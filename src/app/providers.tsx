/**
 * App providers (ARCHITECTURE §5a/§6). This is where the **metadata query plane**
 * finally gets its TanStack Query policy — the piece deliberately deferred out of
 * `src/core` so the engine stayed headless and dependency-light. Metadata reads
 * (search/meta/lyrics) are ordinary idempotent GETs and get the normal policy
 * here; `/stream` never runs through this client — it stays a scheduler-owned
 * command inside the engine (§5a), which is the whole reason for the split.
 */
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServices, type Services } from "./services.js";

const ServicesContext = createContext<Services | undefined>(undefined);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices must be used inside <AppProviders>");
  return services;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Addon metadata is cache-like: reuse it, revalidate in the background.
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  // Constructed once per app instance; StrictMode double-invokes render, so the
  // services must not be rebuilt on every pass.
  const servicesRef = useRef<Services | undefined>(undefined);
  servicesRef.current ??= createServices();
  const [queryClient] = useState(createQueryClient);

  // Deliberately NOT disposed on unmount. In dev, StrictMode double-invokes
  // effects (mount → cleanup → mount), so a dispose-on-cleanup would tear down
  // the engine's audio subscription and MediaSession binding after the first
  // pass and never rebuild them — playback would silently stop working. These
  // services are page-lifetime singletons owned by the root provider, so the
  // browser reclaims them on navigation anyway. `services.dispose()` stays
  // available for tests and any future non-root host.

  return (
    <QueryClientProvider client={queryClient}>
      <ServicesContext.Provider value={servicesRef.current}>{children}</ServicesContext.Provider>
    </QueryClientProvider>
  );
}
