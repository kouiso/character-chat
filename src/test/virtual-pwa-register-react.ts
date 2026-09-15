type UseRegisterSWOptions = {
  onRegisteredSW?: (swUrl: string, registration?: ServiceWorkerRegistration) => void;
};

type UseRegisterSWReturn = {
  needRefresh: readonly [false, () => undefined];
  updateServiceWorker: (reloadPage?: boolean) => Promise<undefined>;
};

export const useRegisterSW: (options?: UseRegisterSWOptions) => UseRegisterSWReturn = () => ({
  needRefresh: [false, () => undefined] as const,
  updateServiceWorker: async () => undefined,
});
