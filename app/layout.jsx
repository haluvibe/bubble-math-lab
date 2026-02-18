import { Orbitron, Exo_2, Rajdhani } from 'next/font/google';

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-orbitron',
  display: 'swap',
});

const exo2 = Exo_2({
  subsets: ['latin'],
  variable: '--font-exo2',
  display: 'swap',
});

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-rajdhani',
  display: 'swap',
});

export const metadata = {
  title: 'Bubble Math Lab',
  description: 'Math games for learning and fun',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${exo2.variable} ${rajdhani.variable}`}>
      <body style={{
        margin: 0,
        padding: 0,
        background: '#04060e',
        color: '#fff',
        minHeight: '100vh',
        fontFamily: 'var(--font-exo2), sans-serif',
      }}>
        {children}
      </body>
    </html>
  );
}
