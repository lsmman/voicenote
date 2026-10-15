import { Stack } from 'expo-router';
import { LandingPage } from '../components/landing/LandingPage';

export default function WelcomeScreen() {
  return <>
    <Stack.Screen options={{ headerShown: false, title: 'Voicenote' }} />
    <LandingPage />
  </>;
}
