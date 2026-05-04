import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, Link } from 'react-router-dom';
import {
  ReviewProvider,
  ReviewOverlay,
  ReviewDashboard,
  ReviewAdmin,
  ReviewLogin,
  useReview,
} from 'web-annotate-kit/client';
import App from './App';

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
          { name: 'Alice (admin)',          password: 'alice' },
          { name: 'Diana (director)',       password: 'diana' },
          { name: 'Leo (lead · design)',    password: 'leo' },
          { name: 'Lena (lead · ling.)',    password: 'lena' },
          { name: 'Rita (reviewer)',        password: 'rita' },
          { name: 'Rob (reviewer)',         password: 'rob' },
        ]}
      />
    );
  }

  if (location.pathname === '/review/admin') {
    return (
      <>
        <ReviewOverlay currentPath={location.pathname} LinkComponent={WiredLink} dashboardPath="/review" adminPath="/review/admin" />
        <ReviewAdmin LinkComponent={WiredLink} homePath="/" title="Demo admin" />
      </>
    );
  }

  if (location.pathname === '/review') {
    return (
      <>
        <ReviewOverlay currentPath={location.pathname} LinkComponent={WiredLink} dashboardPath="/review" adminPath="/review/admin" />
        <ReviewDashboard LinkComponent={WiredLink} homePath="/" title="Demo review" />
      </>
    );
  }

  return (
    <>
      <ReviewOverlay currentPath={location.pathname} LinkComponent={WiredLink} dashboardPath="/review" adminPath="/review/admin" />
      <App />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ReviewProvider apiBase="/api" apiKey="demo-key-2026" captureScreenshots={true}>
        <AuthedApp />
      </ReviewProvider>
    </BrowserRouter>
  </StrictMode>,
);
