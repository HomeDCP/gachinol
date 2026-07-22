import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/auth-context';

export default function AuthLayout(): React.JSX.Element {
  const { session } = useSession();
  if (session.status === 'signedIn') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
