import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

@Injectable({ providedIn: 'root' })
export class FileExportService {
  async save(blob: Blob, fileName: string): Promise<void> {
    const safeName = fileName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
    if (Capacitor.isNativePlatform()) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Unable to read export file'));
        reader.readAsDataURL(blob);
      });
      const result = await Filesystem.writeFile({ path: 'exports/' + safeName, data: base64, directory: Directory.Cache, recursive: true });
      await Share.share({ title: safeName, files: [result.uri], dialogTitle: 'Save or share file' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = safeName;
    document.body.appendChild(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
