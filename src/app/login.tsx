import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { signInWithEmail } from '../sync/auth';
import { useSession } from '../ui/useSession';
import { Button, Input, Notice, Screen } from '../ui/primitives';
import { styles, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';
export default function LoginScreen() {
  const c = useTheme(); const task = useTask(); const { session } = useSession();
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false);
  const submit = () => task.run(async () => { await signInWithEmail(email.trim()); setSent(true); }, '로그인 메일을 보내지 못했어요. 이메일과 연결 상태를 확인해 주세요.');
  return <Screen><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}><View style={styles.content}>
    <Text style={[styles.title, { color: c.text }]}>어디서든 이어지는 노트</Text>
    <Text style={[styles.body, { color: c.muted }]}>이메일로 로그인하면 노트를 동기화하고 요약을 만들 수 있어요.</Text>
    {session ? <Notice text={`${session.user.email ?? ''} 계정으로 로그인했어요.`} /> : <>
      <Input accessibilityLabel="이메일" placeholder="이메일 주소" autoComplete="email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={value => { setEmail(value); setSent(false); }} returnKeyType="send" onSubmitEditing={() => { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) void submit(); }} />
      <Button title={task.busy ? '보내는 중…' : '로그인 링크 받기'} primary disabled={task.busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onPress={() => { void submit(); }} />
      {sent && <Notice text="메일함을 확인하세요. 메일의 로그인 링크를 누르면 연결돼요." />}
    </>}
    {!!task.error && <Notice text={task.error} error />}
  </View></KeyboardAvoidingView></Screen>;
}
