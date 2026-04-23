import { Link, Route, Routes } from 'react-router-dom';

const nav = { display: 'flex', gap: 24, padding: '20px 48px', borderBottom: '1px solid #eee', background: 'white' };
const link = { color: '#305B91', textDecoration: 'none', fontWeight: 500 };
const page = { maxWidth: 720, margin: '0 auto', padding: '64px 24px' };
const h1 = { fontFamily: "'Cormorant Garamond', serif", fontSize: 48, fontWeight: 400, lineHeight: 1.1 };
const p = { fontSize: 18, lineHeight: 1.7, color: '#444' };

function Home() {
  return (
    <main style={page}>
      <h1 style={h1}>A quiet demo page</h1>
      <p style={p}>
        This is a minimal React app with two pages. Log in as Alice (admin) or
        Bob (reviewer), click the <strong>+</strong> button in the bottom right,
        and drop a comment anywhere on this page.
      </p>
      <p style={p}>
        All comments are persisted in a local SQLite database and shown as pins
        anchored to the exact point you clicked. Open <Link to="/review" style={link}>the dashboard</Link> to see them aggregated.
      </p>
      <section>
        <h2 style={{ ...h1, fontSize: 28 }}>Section with a heading</h2>
        <p style={p}>
          The kit captures the nearest section heading automatically, which is
          useful when exporting comments to hand off to an engineer or a writer.
        </p>
      </section>
    </main>
  );
}

function About() {
  return (
    <main style={page}>
      <h1 style={h1}>About this demo</h1>
      <p style={p}>
        <code>web-annotate-kit</code> is a reusable library for pinning review
        comments on any live website. The client is a set of React components;
        the server is an Express router with a pluggable storage adapter
        (SQLite, Turso, or custom).
      </p>
      <p style={p}>
        Try leaving a comment on this page and switching back to
        <Link to="/" style={{ ...link, marginLeft: 6 }}>Home</Link>. Pins are scoped per URL.
      </p>
    </main>
  );
}

export default function App() {
  return (
    <>
      <nav style={nav}>
        <Link to="/" style={link}>Home</Link>
        <Link to="/about" style={link}>About</Link>
        <Link to="/review" style={link}>Dashboard</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </>
  );
}
