import { QueryClient } from "@tanstack/react-query";

// Re-export `request` from the HTTP layer for convenient use with `useQuery` / `useMutation`.
// Example:
//   const { data } = useQuery({ queryKey: ["items"], queryFn: () => request<Item[]>("/items") });
import { request } from "./api/http";
export { request };

// Use `useQuery` for reads, `useMutation` for writes. Use `requestBlob`/`fetchApi` directly for binary downloads and custom response handling.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
