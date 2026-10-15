import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLanguage } from '../i18n/language';
import { createApiToken, listApiTokens, revokeApiToken, type ApiToken } from '../sync/apiTokens';

const strings = {
  ko: { title: 'AI 연결 · API 토큰', help: '동기화된 노트를 읽는 전용 토큰입니다. 최대 20개까지 만들 수 있습니다.', name: '토큰 이름', create: '토큰 만들기', revoke: '폐기', copy: '복사', copied: '복사됨', once: '이 토큰은 지금 한 번만 표시됩니다. 안전한 곳에 복사하세요.', hide: '토큰 숨기기', empty: '아직 토큰이 없습니다.', error: '요청에 실패했습니다. 로그인과 연결을 확인하세요.', manual: '자동 복사가 불가능합니다. 텍스트를 선택하여 복사하세요.', refresh: '새로고침', url: 'MCP 주소', config: 'Claude Code 설정 예시', used: '마지막 사용', never: '사용 전', busy: '처리 중…' },
  en: { title: 'AI connections · API tokens', help: 'Read-only access to synced notes. Create up to 20 tokens.', name: 'Token name', create: 'Create token', revoke: 'Revoke', copy: 'Copy', copied: 'Copied', once: 'This token is shown only now. Copy it somewhere safe.', hide: 'Hide token', empty: 'No tokens yet.', error: 'Request failed. Check your sign-in and connection.', manual: 'Automatic copying is unavailable. Select and copy the text.', refresh: 'Refresh', url: 'MCP URL', config: 'Claude Code configuration example', used: 'Last used', never: 'Never', busy: 'Working…' },
  zh: { title: 'AI 连接 · API 令牌', help: '只读访问已同步的笔记。最多可创建 20 个令牌。', name: '令牌名称', create: '创建令牌', revoke: '撤销', copy: '复制', copied: '已复制', once: '此令牌仅显示一次。请复制并妥善保管。', hide: '隐藏令牌', empty: '暂无令牌。', error: '请求失败。请检查登录状态和网络连接。', manual: '无法自动复制。请选择文本并复制。', refresh: '刷新', url: 'MCP 地址', config: 'Claude Code 配置示例', used: '上次使用', never: '从未使用', busy: '处理中…' },
};
function TokenButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
export default function ApiTokens() {
  const text = strings[useLanguage()];
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [plaintext, setPlaintext] = useState<{ id?: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);
  const url = `${(process.env.EXPO_PUBLIC_API_BASE || 'https://voicenote-ten-alpha.vercel.app').replace(/\/$/, '')}/api/mcp`;
  // Keep the real secret out of the reusable configuration example.
  const config = JSON.stringify({ mcpServers: { voicenote: { type: 'http', url, headers: { Authorization: 'Bearer vn_YOUR_TOKEN' } } } }, null, 2);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    listApiTokens().then(value => { if (active) setTokens(value); }).catch(() => { if (active) setMessage(text.error); });
    return () => { active = false; mounted.current = false; };
  }, [text.error]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setMessage('');
    try { await action(); } catch { if (mounted.current) setMessage(text.error); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function copy(value: string) {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(value);
      if (mounted.current) setMessage(text.copied);
    } catch { if (mounted.current) setMessage(text.manual); }
  }
  return <View style={styles.container}>
    <Text style={styles.title}>{text.title}</Text>
    <Text>{text.help}</Text>
    <TextInput accessibilityLabel={text.name} placeholder={text.name} value={name} onChangeText={setName} maxLength={60} editable={!busy} autoCapitalize="none" style={styles.input} />
    <TokenButton label={text.create} onPress={() => void run(async () => {
      const value = await createApiToken(name);
      if (!mounted.current) return;
      setPlaintext({ value }); setName('');
      // A failed refresh must not discard the only copy of the new token.
      const next = await listApiTokens();
      if (mounted.current) { setTokens(next); setPlaintext({ value, id: next.find(item => item.prefix === value.slice(0, 10))?.id }); }
    })} disabled={busy || !name.trim() || tokens.length >= 20} />
    {plaintext && <View style={styles.card}>
      <Text>{text.once}</Text>
      <Text selectable style={styles.code}>{plaintext.value}</Text>
      <TokenButton label={text.copy} disabled={busy} onPress={() => void copy(plaintext.value)} />
      <TokenButton label={text.hide} disabled={busy} onPress={() => setPlaintext(null)} />
    </View>}
    {busy && <Text accessibilityLiveRegion="polite">{text.busy}</Text>}
    {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
    {tokens.length === 0 && <Text>{text.empty}</Text>}
    {tokens.map(token => <View key={token.id} style={styles.card}>
      <Text style={styles.title}>{token.name}</Text>
      <Text selectable>{token.prefix}…</Text>
      <Text>{text.used}: {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : text.never}</Text>
      <TokenButton label={text.revoke} disabled={busy} onPress={() => void run(async () => {
        await revokeApiToken(token.id);
        if (mounted.current) {
          setTokens(items => items.filter(item => item.id !== token.id));
          setPlaintext(current => current?.id === token.id || current?.value.startsWith(token.prefix) ? null : current);
        }
      })} />
    </View>)}
    <TokenButton label={text.refresh} disabled={busy} onPress={() => void run(async () => { const next = await listApiTokens(); if (mounted.current) setTokens(next); })} />
    <Text style={styles.title}>{text.url}</Text>
    <Text selectable>{url}</Text>
    <TokenButton label={text.copy} disabled={busy} onPress={() => void copy(url)} />
    <Text style={styles.title}>{text.config}</Text>
    <Text selectable style={styles.code}>{config}</Text>
    <TokenButton label={text.copy} disabled={busy} onPress={() => void copy(config)} />
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 12, paddingVertical: 16 },
  title: { fontSize: 17, fontWeight: '600', color: '#242420' },
  input: { borderWidth: 1, borderColor: '#aaa79e', borderRadius: 8, padding: 12, minHeight: 44, color: '#242420' },
  button: { minHeight: 44, padding: 12, borderRadius: 8, backgroundColor: '#eceae3', justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#242420', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  card: { gap: 8, borderWidth: 1, borderColor: '#d6d2c8', borderRadius: 10, padding: 12 },
  code: { fontFamily: 'monospace', fontSize: 12, color: '#242420' },
});
