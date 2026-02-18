'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const BubbleMathLab = dynamic(() => import('@/components/games/BubbleMathLab'), { ssr: false });

export default function BubbleMathLabPage() {
  return (
    <>
      <div style={{
        position: 'fixed',
        top: '1rem',
        left: '1rem',
        zIndex: 9999,
      }}>
        <Link href="/" style={{
          fontFamily: 'var(--font-orbitron), sans-serif',
          fontSize: '0.7rem',
          color: 'rgba(255,255,255,0.4)',
          textDecoration: 'none',
          padding: '0.4rem 0.8rem',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '6px',
          background: 'rgba(0,0,0,0.5)',
          transition: 'all 0.2s',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          ← Back
        </Link>
      </div>
      <BubbleMathLab />
    </>
  );
}
