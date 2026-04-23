import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  ReviewProvider,
  ReviewOverlay,
  ReviewDashboard,
  ReviewLogin,
  useReview,
} from 'web-annotate-kit/client';
import App from './App';

/* Hooked-in components that plug react-router into the kit. */

function WiredLink({ to, className, title, onClick, children }: { to: string; className?: string; title?: string; onClick?: () => void; children: React.ReactNode }) {
  return <Link to={to} className={className} title={title} onClick={onClick}>{children}</Link>;
}

function AuthedApp() {
  const { user } = useReview();
  const location = useLocation();

  if (!user) {
    return (
      <ReviewLogin
        brand="Demo"
        subtitle="web-annotate-kit"
        accentColor="#305B91"
        devPasswords={[
          { name: 'Alice (admin)', password: 'alice' },
          { name: 'Bob', password: 'bob' },
        ]}
      />
    );
  }

  if (location.pathname === '/review') {
    return (
      <>
        <ReviewOverlay
          currentPath={location.pathname}
          LinkComponent={WiredLink}
          dashboardPath="/review"
        />
        <ReviewDashboard LinkComponent={WiredLink} homePath="/" title="Demo review" />
      </>
    );
  }

  return (
    <>
      <ReviewOverlay
        currentPath={location.pathname}
        LinkComponent={WiredLink}
        dashboardPath="/review"
      />
      <App />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ReviewProvider
        apiBase="/api"
        apiKey="demo-key-2026"
        captureScreenshots={true}
        users={[
          { id: 'alice',  name: 'Alice', password: 'alice', color: '#3B82F6', role: 'admin' },
          { id: 'bob',    name: 'Bob',   password: 'bob',   color: '#10B981', role: 'reviewer' },
        ]}
      >
        <AuthedApp />
      </ReviewProvider>
    </BrowserRouter>
  </StrictMode>,
);
