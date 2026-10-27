import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

const getOnline = () => navigator.onLine;
const getServerOnline = () => true;

export const useChatOnline = () => useSyncExternalStore(subscribe, getOnline, getServerOnline);
