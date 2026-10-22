let walletAddress: string | null = null;
let cachedAddress: string | null | undefined;
let cachedToken: string | null = null;
let refreshPromise: {
  address: string | null;
  generation: number;
  promise: Promise<string>;
} | null = null;
let generation = 0;

export function setCsrfWalletAddress(address: string | null): void {
  if (address === walletAddress) return;

  walletAddress = address;
  cachedAddress = undefined;
  cachedToken = null;
  generation += 1;

  if (address) void getCsrfToken();
}

export async function getCsrfToken(): Promise<string> {
  while (true) {
    const requestAddress = walletAddress;
    const requestGeneration = generation;

    if (cachedAddress === requestAddress && cachedToken) return cachedToken;

    if (!refreshPromise) {
      let request: Promise<string>;
      request = Promise.resolve()
        .then(() =>
          fetch("/api/auth/csrf", {
            method: "GET",
            credentials: "same-origin",
          }),
        )
        .then(async (response) => {
          if (!response.ok) return "";
          const data = await response.json().catch(() => ({}));
          const token = typeof data?.token === "string" ? data.token : "";
          if (token && generation === requestGeneration) {
            cachedAddress = requestAddress;
            cachedToken = token;
          }
          return token;
        })
        .catch(() => "")
        .finally(() => {
          if (refreshPromise?.promise === request) refreshPromise = null;
        });
      refreshPromise = {
        address: requestAddress,
        generation: requestGeneration,
        promise: request,
      };
    }

    const refresh = refreshPromise;
    if (!refresh) continue;
    if (refresh.address !== requestAddress || refresh.generation !== requestGeneration) {
      await refresh.promise;
      continue;
    }

    await refresh.promise;
    if (requestAddress !== walletAddress || requestGeneration !== generation) continue;
    return cachedAddress === requestAddress ? cachedToken ?? "" : "";
  }
}