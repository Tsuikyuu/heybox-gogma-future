import { archiveSchema } from './model';
import type { Archive } from './model';

export const standalone = import.meta.env.DEV && import.meta.env.VITE_STANDALONE === '1';

export async function openStorage(onHide: () => void) {
  const key = 'gogma-mvp-v1';
  if (standalone) return {
    read: async () => {
      const text = localStorage.getItem(key);
      return text === null ? undefined : archiveSchema.parse(JSON.parse(text));
    },
    write: async (data: Archive) => { localStorage.setItem(key, JSON.stringify(data)); },
  };
  const { default: hbSDK } = await import('@heybox/hb-sdk');
  const unsubscribe = hbSDK.on('hide', onHide);
  hbSDK.on('unload', () => { onHide(); unsubscribe(); });
  return {
    read: async () => {
      const result = await hbSDK.storage.getStorage({ key });
      return result.data === undefined ? undefined : archiveSchema.parse(result.data);
    },
    write: async (data: Archive) => { await hbSDK.storage.setStorage({ key, data }); },
  };
}
