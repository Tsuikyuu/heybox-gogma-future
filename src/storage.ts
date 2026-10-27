import { archiveSchema } from './model';
import type { Archive } from './model';

export const standalone = import.meta.env.DEV && import.meta.env.VITE_STANDALONE === '1';

export async function openStorage(onHide: () => void) {
  const key = 'gogma-mvp-v1';
  if (standalone) return {
    saveFile: async (name: string, content: () => Promise<Uint8Array>, mime: string) => {
      const bytes = await content();
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    },
    read: async () => {
      const text = localStorage.getItem(key);
      return text === null ? undefined : archiveSchema.parse(JSON.parse(text));
    },
    write: async (data: Archive) => { localStorage.setItem(key, JSON.stringify(data)); },
  };
  const { default: hbSDK, HbMiniProgramSDKError } = await import('@heybox/hb-sdk');
  const unsubscribe = hbSDK.on('hide', onHide);
  hbSDK.on('unload', () => { onHide(); unsubscribe(); });
  return {
    saveFile: async (name: string, content: () => Promise<Uint8Array>, _mime: string) => {
      // Storage initialization completes the handshake before the main UI is rendered.
      if (hbSDK.getHandshakeState().status !== 'ready') throw new Error('文件保存尚未就绪，请重新打开小程序');
      // Open the picker before loading ExcelJS or generating the workbook to retain the click gesture.
      return hbSDK.files.saveFile({ suggestedName: name }).then(async (file) => {
        const bytes = await content();
        if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('文件超过 8 MiB，请减少预测次数或武器数量后导出');
        await file.writeBytes(bytes);
        return true;
      }).catch((error: unknown) => {
        if (!(error instanceof HbMiniProgramSDKError)) throw error;
        if (error.code === 'FILE_PICKER_CANCELLED') return false;
        if (error.code === 'METHOD_FORBIDDEN' || error.code === 'METHOD_NOT_FOUND') throw new Error('当前客户端不支持文件导出，请在支持文件保存的新版小黑盒客户端中使用');
        if (error.code === 'FILE_ALREADY_EXISTS') throw new Error('同名文件已存在，请更换保存位置或文件名');
        throw error;
      });
    },
    read: async () => {
      const result = await hbSDK.storage.getStorage({ key });
      return result.data === undefined ? undefined : archiveSchema.parse(result.data);
    },
    write: async (data: Archive) => { await hbSDK.storage.setStorage({ key, data }); },
  };
}
