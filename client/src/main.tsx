import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './app/styles/theme.css';
import './app/styles/base.css';

import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { APP_NAME } from '@shared/core';
import { spring, useReducedMotionPref } from './lib/motion';
import { App } from './app/App';

/** Design §4.4: OS setting via `reducedMotion="user"`, in-app setting forces `"always"`. */
function MotionRoot({ children }: { children: ReactNode }) {
  const reduced = useReducedMotionPref();
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'} transition={spring.smooth}>
      {children}
    </MotionConfig>
  );
}

document.title = APP_NAME;

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <MotionRoot>
      <App />
    </MotionRoot>
  </StrictMode>,
);
