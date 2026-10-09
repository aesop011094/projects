const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function readImage(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error('請選擇 JPG、PNG 或 WebP 圖片。');
  if (file.size > MAX_FILE_BYTES) throw new Error('圖片太大，請選擇 10 MB 或以下的圖片。');
  if (file.size === 0) throw new Error('圖片檔案是空的，請重新選擇。');
  const objectUrl = URL.createObjectURL(file);
  try {
    const original = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('無法讀取這張圖片，請嘗試另一張。'));
      image.src = objectUrl;
    });
    if (!original.naturalWidth || !original.naturalHeight) throw new Error('圖片尺寸不正確。');
    const ratio = Math.min(1, 1200 / Math.max(original.naturalWidth, original.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(original.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(original.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('這個瀏覽器未能處理圖片，請改用其他瀏覽器。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(original, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.84);
    if (!result.startsWith('data:image/jpeg;base64,')) throw new Error('圖片處理失敗，請重新選擇。');
    return result;
  } finally { URL.revokeObjectURL(objectUrl); }
}
