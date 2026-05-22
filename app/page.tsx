import { Loader2 } from 'lucide-react';

export default function Home() {
  return (
    <div style={styles.container}>
      <Loader2 size={32} className="animate-spin" color="var(--primary)" />
      <p style={styles.text}>Redireccionando...</p>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    backgroundColor: '#0b0f19',
    color: '#ffffff',
  },
  text: {
    fontSize: '0.95rem',
    color: '#9ca3af',
    fontWeight: '500',
  },
};
