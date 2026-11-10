import { StrictMode, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import { applyBrandTheme, brand } from './config/brand'
import { I18nProvider } from './i18n'
import { SessionProvider } from './lib/session'
import { AppShell } from './components/AppShell'
import Home from './routes/home'

applyBrandTheme()
document.title = brand.name

// Each role's screens are code-split so the finder's first load on a cheap phone stays small.
const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'f/*', Component: lazy(() => import('./routes/finder')) },
      { path: 'p/*', Component: lazy(() => import('./routes/parent')) },
      { path: 'checkin/*', Component: lazy(() => import('./routes/checkin')) },
      { path: 'sp/*', Component: lazy(() => import('./routes/safepoint')) },
      { path: 'admin/*', Component: lazy(() => import('./routes/admin')) },
      { path: 'police/*', Component: lazy(() => import('./routes/police')) },
      { path: '*', element: <Home /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
)
