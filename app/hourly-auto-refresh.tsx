'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const HOUR_MS = 60 * 60 * 1000;

export default function HourlyAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const delayUntilNextHour = HOUR_MS - (Date.now() % HOUR_MS) + 1000;

    const timeoutId = setTimeout(() => {
      router.refresh();
      intervalId = setInterval(() => router.refresh(), HOUR_MS);
    }, delayUntilNextHour);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [router]);

  return null;
}
