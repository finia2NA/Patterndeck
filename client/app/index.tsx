import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { getAuthToken } from '@/lib/storage';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    async function check() {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/onboarding');
        return;
      }
      router.replace('/home');
    }
    check();
  }, [router]);

  return null;
}
