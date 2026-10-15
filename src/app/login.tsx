import { t, useT } from '../i18n';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { signInWithEmail } from '../sync/auth';
import { isSyncConfigured } from '../sync';
import { useSession } from '../ui/useSession';
import { Button, Input, Notice, Screen } from '../ui/primitives';
import { styles, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';
export default function LoginScreen() {
  useT();
  const c = useTheme(); const task = useTask(); const { session } = useSession();
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false);
  const submit = () => task.run(async () => { await signInWithEmail(email.trim()); setSent(true); }, t('loginEmailError'));
  return <Screen><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}><View style={[styles.content, { maxWidth: 420 }]}>
    <Text style={[styles.title, { color: c.text }]}>{t('loginTitle')}</Text>
    {isSyncConfigured && <Text style={[styles.small, { color: c.muted }]}>{t('loginDescription')}</Text>}
    {!isSyncConfigured ? <Notice text={t('localOnly')} /> : session ? <Notice text={t('signedInAs', { p0: session.user.email ?? '' })} /> : <>
      <Input accessibilityLabel={t('email')} placeholder={t('emailAddress')} autoComplete="email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={value => { setEmail(value); setSent(false); }} returnKeyType="send" onSubmitEditing={() => { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) void submit(); }} />
      <Button title={task.busy ? t('sending') : t('getLoginLink')} primary disabled={task.busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onPress={() => { void submit(); }} />
      {sent && <Notice text={t('checkEmail')} />}
    </>}
    {!!task.error && <Notice text={task.error} error />}
  </View></KeyboardAvoidingView></Screen>;
}
