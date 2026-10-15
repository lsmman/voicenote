import { getLanguage } from '../i18n/language';

const timestamp = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}`;
const defaultTitlePattern = new RegExp(`^(?:${timestamp} 녹음|Recording ${timestamp}|录音 ${timestamp})$`);

export function isDefaultTitle(title: string): boolean {
  return defaultTitlePattern.test(title);
}

export function createDefaultTitle(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  switch (getLanguage()) {
    case 'ko': return `${time} 녹음`;
    case 'en': return `Recording ${time}`;
    case 'zh': return `录音 ${time}`;
  }
}
