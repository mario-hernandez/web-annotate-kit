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
          { name: 'Alice (admin)',          id: 'alice', password: 'alice-pw-2026' },
          { name: 'Diana (director)',       id: 'diana', password: 'diana-pw-2026' },
          { name: 'Leo (lead · design)',    id: 'leo',   password: 'leo-pw-2026' },
          { name: 'Lena (lead · ling.)',    id: 'lena',  password: 'lena-pw-2026' },
          { name: 'Rita (reviewer)',        id: 'rita',  password: 'rita-pw-2026' },
          { name: 'Rob (reviewer)',         id: 'rob',   password: 'rob-pw-2026' },
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
