'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/trade');
  }, [router]);

  return <div className="min-h-screen bg-[#0B0E11]"></div>;
}