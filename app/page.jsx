import Link from 'next/link';

const games = [
  {
    title: 'MathStorm',
    subtitle: 'Number Squadron',
    description: 'Vertical shooter where your weapons are math operations. Blast enemies to transform your Power Number!',
    href: '/mathstorm',
    emoji: '⚡',
    color: '#4ade80',
    glow: 'rgba(74, 222, 128, 0.3)',
  },
  {
    title: 'Bubble Math Lab',
    subtitle: 'Laboratory',
    description: 'Drag, merge, and split number bubbles to solve equations. Capture creatures by matching target values!',
    href: '/bubblemathlab',
    emoji: '🫧',
    color: '#a78bfa',
    glow: 'rgba(167, 139, 250, 0.3)',
  },
];

export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <h1 style={{
        fontFamily: 'var(--font-orbitron), sans-serif',
        fontSize: 'clamp(1.8rem, 5vw, 3rem)',
        textAlign: 'center',
        marginBottom: '0.5rem',
        background: 'linear-gradient(135deg, #4ade80, #a78bfa, #38bdf8)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        Bubble Math Lab
      </h1>
      <p style={{
        fontFamily: 'var(--font-rajdhani), sans-serif',
        fontSize: '1.1rem',
        color: 'rgba(255,255,255,0.5)',
        marginBottom: '3rem',
        textAlign: 'center',
      }}>
        Choose a game to play
      </p>

      <div style={{
        display: 'flex',
        gap: '2rem',
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: '800px',
        width: '100%',
      }}>
        {games.map((game) => (
          <Link
            key={game.href}
            href={game.href}
            style={{
              textDecoration: 'none',
              color: 'inherit',
              flex: '1 1 300px',
              maxWidth: '380px',
            }}
          >
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid rgba(255,255,255,0.08)`,
              borderRadius: '16px',
              padding: '2rem',
              transition: 'all 0.3s ease',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
            }}
              onMouseEnter={undefined}
            >
              <div style={{
                fontSize: '3rem',
                marginBottom: '1rem',
              }}>
                {game.emoji}
              </div>
              <h2 style={{
                fontFamily: 'var(--font-orbitron), sans-serif',
                fontSize: '1.4rem',
                color: game.color,
                margin: '0 0 0.25rem 0',
              }}>
                {game.title}
              </h2>
              <p style={{
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: '0.85rem',
                color: 'rgba(255,255,255,0.4)',
                margin: '0 0 1rem 0',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}>
                {game.subtitle}
              </p>
              <p style={{
                fontFamily: 'var(--font-exo2), sans-serif',
                fontSize: '0.95rem',
                color: 'rgba(255,255,255,0.6)',
                margin: 0,
                lineHeight: 1.5,
              }}>
                {game.description}
              </p>
              <div style={{
                marginTop: '1.5rem',
                fontFamily: 'var(--font-orbitron), sans-serif',
                fontSize: '0.75rem',
                color: game.color,
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
              }}>
                Play →
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
