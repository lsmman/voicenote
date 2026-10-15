import { t } from '../i18n';
import { Alert, Platform, Share } from 'react-native';
import { buildExport, type ExportNote } from './format';
export function confirmAction(message: string, label = t('confirm')): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise(resolve => Alert.alert(t('confirm'), message, [
    { text: t('cancel'), style: 'cancel', onPress: () => resolve(false) },
    { text: label, onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}
export async function exportNote(data: ExportNote, format: 'txt' | 'md'): Promise<void> {
  const content = buildExport(data, format);
  if (Platform.OS !== 'web') { await Share.share({ title: data.note.title, message: content }); return; }
  const url = URL.createObjectURL(new Blob([content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${data.note.title.replace(/[\\/:*?"<>|]/g, '_') || t('note')}.${format}`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
