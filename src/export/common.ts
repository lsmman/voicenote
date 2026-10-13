export function safeTitle(title: string): string {
  return title.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 80) || 'recording';
}
export const isMp4 = (mime: string) => /^(audio\/(mp4|m4a|x-m4a)|video\/mp4)(;|$)/i.test(mime);
export function audioExtension(mime: string): string {
  const type = mime.split(';')[0].toLowerCase();
  return ({ 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac' } as Record<string, string>)[type] ?? (isMp4(type) ? 'm4a' : 'bin');
}
